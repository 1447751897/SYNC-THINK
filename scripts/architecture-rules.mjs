import path from 'node:path';
import ts from 'typescript';

const contractLeaves = new Set([
  'apps/desktop/src/renderer/shell/conversation-types.ts',
  'apps/desktop/src/renderer/shell/composer-editor-types.ts',
  'apps/desktop/src/renderer/shell/message-text-types.ts',
  'packages/workers/src/desktop/windows-uia-contract.ts',
]);
const formerDesktopSharedUiModules = new Set([
  'apps/desktop/src/renderer/shell/ComposerModeBanner.js',
  'apps/desktop/src/renderer/shell/ComposerTaskPanel.js',
  'apps/desktop/src/renderer/shell/NewMaxComposerFrame.js',
]);
const browserProfileCommands = new Set([
  'browser.profile.list',
  'browser.profile.create',
  'browser.profile.rename',
  'browser.profile.delete',
  'browser.profile.listSiteSessions',
  'browser.profile.clearSiteSession',
]);
const browserRecordingCommands = new Set([
  'browser.recording.list',
  'browser.recording.get',
  'browser.recording.start',
  'browser.recording.stop',
]);
const browserWorkflowCommands = new Set([
  'browser.workflow.list',
  'browser.workflow.get',
  'browser.workflow.createDraft',
  'browser.workflow.createRevisionDraft',
  'browser.workflow.submit',
  'browser.workflow.review',
  'browser.workflow.execute',
  'browser.workflow.approveAndExecute',
]);
const browserPayloadAdapterPattern =
  /^(?:apps\/desktop\/src\/browser-(?:profile|recording|workflow)-payloads|apps\/runtime\/src\/validation\/browser-(?:profile|recording|workflow))\.ts$/;
const browserPayloadRuleNames = new Set([
  'hasAsciiControlCharacter',
  'hasOnlyKeys',
  'isRecord',
  'validHttpUrl',
  'validId',
  'validPositiveInteger',
  'validText',
  'validVariables',
]);
const pathContainmentConsumerPattern =
  /^(?:apps\/desktop\/src\/main|apps\/runtime\/src|packages\/(?:storage|workers)\/src)\/.*\.ts$/;
const localPathContainmentNames = new Set(['isPathInside', 'isWithin']);
const sharedAsciiControlOwner = 'packages/shared/src/string-validation.ts';
const sharedRecordOwner = 'packages/shared/src/value-validation.ts';
const binaryByteScalingConsumers = new Set([
  'apps/desktop/src/renderer/shell/BrowserStage.tsx',
  'packages/ui-kit/src/components/ArtifactVersionsPanel.tsx',
  'packages/storage/src/scripts/database-governance.ts',
]);
const secretInputPolicyHosts = new Set([
  'apps/desktop/src/renderer/shell/ModelSettings.tsx',
  'apps/desktop/src/renderer/shell/ImageGenerationSettings.tsx',
  'apps/desktop/src/renderer/shell/BotConversationPane.tsx',
]);
const toggleControlHosts = new Set([
  'apps/desktop/src/renderer/shell/abilities/AbilityCenterPage.tsx',
  'apps/desktop/src/renderer/shell/BotConversationPane.tsx',
  'apps/desktop/src/renderer/shell/DesktopUpdatePanel.tsx',
  'apps/desktop/src/renderer/shell/ModelSettings.tsx',
  'apps/desktop/src/renderer/shell/PreferencesSettings.tsx',
  'apps/desktop/src/renderer/shell/SettingsPage.tsx',
  'apps/desktop/src/renderer/shell/WebSearchSettings.tsx',
]);
const compositeSwitchClassesByHost = new Map([
  [
    'apps/desktop/src/renderer/shell/abilities/AbilityCenterPage.tsx',
    new Set(['skill-workspace-menu__row']),
  ],
]);
const legacyImageValidationNames = new Set([
  'allowedMimeType',
  'extensionMatchesMime',
  'magicMatchesMime',
  'detectImageMimeType',
]);
const vendorLoaderAdapterPattern =
  /^apps\/desktop\/src\/renderer\/shell\/(?:mermaid|xterm|excalidraw)-vendor-loader\.ts$/;
const runtimeSkillMarketFile = 'apps/runtime/src/skill-market.ts';
const rendererSkillMarketFile = 'apps/desktop/src/renderer/shell/abilities/capability-market.ts';
const obsoleteAbilitiesPageFile = 'apps/desktop/src/renderer/shell/AbilitiesPage.tsx';
const obsoleteDesktopRefreshCoordinatorFile =
  'apps/desktop/src/renderer/shell/refresh-coordinator.ts';
const obsoleteTelegramBotClientFile = 'apps/runtime/src/telegram-bot-client.ts';
const runtimeFile = 'apps/runtime/src/runtime.ts';
const retiredRuntimeProviderProjectionNames = new Set(['toProviderSummary', 'toModelSummary']);
const retiredRuntimeDesktopWaitingProjectionNames = new Set(['toDesktopWaitingCommandSummary']);
const retiredRuntimePlatformAdapterNames = new Set(['toPlatformAgentStore']);
const retiredRuntimeScheduledTaskProjectionNames = new Set(['fillTaskHistorySummary']);
const retiredRuntimeProviderLookupNames = new Set(['providerSummaryById']);
const retiredRuntimeProviderDiscoveryNames = new Set(['resolveDiscoveryAdapter']);
const retiredRuntimePromptEnhancementNames = new Set([
  'parsePromptEnhancePayload',
  'resolvePromptEnhancementModelId',
]);
const retiredRuntimeArtifactContentNames = new Set(['isTextArtifactMime']);
const retiredRuntimeCcSwitchPathNames = new Set(['resolveCcSwitchDbPath']);
const retiredRuntimeContextSnapshotCacheNames = new Set([
  'contextSnapshotByThread',
  'contextSnapshotCacheKey',
  'setConversationContextSnapshot',
]);
const retiredRuntimeRunKernelRegistryNames = new Set([
  'runKernelIds',
  'runKernelIdsLoaded',
  'ensureRunKernelIdsLoaded',
  'recordRunKernel',
]);
const retiredRuntimePolicyScopeNames = new Set([
  'validatePolicySaveScope',
  'buildApplicablePolicyScopes',
  'hasApplicablePolicyForTask',
  'requirePolicyWorkspace',
  'requirePolicyTask',
  'requirePolicyAgent',
]);
const retiredRuntimePendingAskNames = new Set(['pendingAsks']);
const retiredRuntimeFormalPlanRevisionNames = new Set([
  'formalPlanRevisionByRun',
  'formalPlanRevisionForRun',
]);
const retiredRuntimeScheduledTaskDispatchNames = new Set(['dispatchedTasks', 'taskIdByRun']);
const retiredRuntimeContextAmendmentNames = new Set(['threadContextAmendments']);
const retiredRuntimeCompactBoundaryNames = new Set([
  'latestCompactByThread',
  'resolveLatestCompactBoundary',
]);
const retiredRuntimeDeadContextRunNames = new Set(['contextRunByThread']);
const retiredRuntimeDurableToolApprovalNames = new Set([
  'durableChatToolApprovalStateById',
  'durableChatToolApprovalStates',
  'rememberDurableChatToolApprovalEvent',
]);
const retiredRuntimeCapabilityUsageNames = new Set([
  'recordedCapabilityUsageKeys',
  'appendCapabilityUsageOnce',
]);
const retiredRuntimeAssistantTimelineNames = new Set(['assistantTimelineFingerprintsByRun']);
const retiredRuntimePlatformMcpRunNames = new Set([
  'platformMcpCatalogByRun',
  'platformMcpResultsByRun',
  'capabilityBrokerByRun',
]);
const retiredRuntimeScheduledTaskRunNames = new Set(['taskRuns', 'scheduledTaskRuns']);
const retiredRuntimePromiseLifecycleNames = new Set([
  'daemonCompletionPromises',
  'backgroundTasks',
  'activeKernelRuns',
]);
const retiredRuntimeExternalEventExecutionNames = new Set([
  'externalEventExecutions',
  'externalEventIdByRun',
  'externalEventCleanupRuns',
]);
const retiredRuntimeAbortControllerNames = new Set(['demoRunAborts', 'promptEnhancementAborts']);
const retiredRuntimeKernelToolProgressNames = new Set(['kernelToolProgressByRun']);
const retiredRuntimeExternalKernelSessionQueueNames = new Set([
  'externalKernelSessionTails',
  'enqueueExternalKernelSession',
]);
const retiredRuntimeActiveRunNames = new Set(['inFlight', 'recordInFlight', 'forgetInFlight']);
const retiredRuntimeCompletedDelegatedRunNames = new Set(['completedDelegatedRunStates']);
const retiredRuntimeLocalSkillWatchNames = new Set([
  'localSkillWatchCleanup',
  'localSkillWatchedDirectories',
]);
const retiredRuntimeMcpAuthConfigNames = new Set([
  'mcpAuthHandles',
  'mcpAuthSettingKey',
  'readMcpAuthConfig',
  'persistMcpAuth',
]);
const retiredRuntimeLocalSkillRefreshNames = new Set([
  'localSkillRefreshGeneration',
  'localSkillRefreshAppliedGeneration',
  'localSkillRefreshInFlight',
]);
const retiredRuntimeSubscriptionNames = new Set(['subscriptions', 'transientSubscriptions']);
const retiredRuntimeTransientStateNames = new Set([
  'transientSnapshotByThread',
  'transientSequenceByThread',
]);
const retiredRuntimeThreadVersionNames = new Set(['threadVersions']);
const retiredRuntimeGoalExecutionStateNames = new Set([
  'activeGoals',
  'goalRunRevisions',
  'pendingGoalTurns',
]);
const retiredRuntimeKernelConversationSessionNames = new Set([
  'kernelConversationSessions',
  'parsePersistedKernelConversationSession',
]);
const retiredRuntimeCatalogSummaryNames = new Set([
  'toAgentBindingSummary',
  'toAgentDefinitionSummary',
  'toCapabilityWorkspaceActivationSummary',
  'toCapabilityUsageSummary',
  'toSkillPublishDraftSummary',
  'toCapabilityOrganizeReportSummary',
  'toMemoryChangeSummary',
  'toDurableMemoryEntrySummary',
  'toDiagnosticSummary',
  'toApprovalRequestSummary',
  'toWorkspaceSummary',
  'toSkillVersionSummary',
  'toMcpServerSummary',
  'toGlobalAgentSummary',
  'toTeamSummary',
  'toTeamRunSummary',
  'toConversationSummary',
]);
const legacyTelegramRuntimeNames = new Set([
  'telegramBotClient',
  'telegramBotAbort',
  'telegramBotLoop',
  'readTelegramBotConfig',
  'writeTelegramBotConfig',
  'telegramBotConfigSummary',
  'telegramBotToken',
  'handleGetBotChannelConfig',
  'handleTestBotChannel',
  'handleSaveBotChannelConfig',
  'restartTelegramBotLoop',
  'runTelegramBotLoop',
  'processTelegramMessage',
  'getOrCreateTelegramConversation',
  'executeTelegramConversationTurn',
]);
const retiredTestOnlyRendererHelpers = new Map([
  [
    'apps/desktop/src/renderer/shell/compose-mention.ts',
    new Set(['applyMention', 'extractMentionPaths']),
  ],
  ['apps/desktop/src/renderer/shell/compose-toolbar.tsx', new Set(['coerceReasoningEffort'])],
]);
const obsoleteAbilitiesPageModule = 'apps/desktop/src/renderer/shell/AbilitiesPage.js';
const abilityCenterImplementationModule =
  'apps/desktop/src/renderer/shell/abilities/AbilityCenterPage.js';
const abilityCenterImplementationFile =
  'apps/desktop/src/renderer/shell/abilities/AbilityCenterPage.tsx';
const duplicatedSkillMarketSummaryFields = new Set([
  'id',
  'name',
  'category',
  'author',
  'version',
  'icon',
]);
const browserHandoffCommands = new Set([
  'browser.handoff.listWaiting',
  'browser.handoff.continue',
  'browser.handoff.cancel',
]);
const desktopCommands = new Set([
  'desktop.command.listWaiting',
  'desktop.command.continue',
  'desktop.command.cancel',
]);
const browserExtensionCommands = new Set([
  'browser.extension.status',
  'browser.extension.restart',
  'browser.extension.resetPairing',
  'browser.extension.openFolder',
]);
const approvalCommands = new Set([
  'approval.list',
  'approval.evaluate',
  'approval.enqueue',
  'approval.decide',
]);
const memoryCommands = new Set(['memory.list', 'memory.decide', 'memory.rollback']);
const contextPacketCommands = new Set(['context.packet.peek', 'context.packet.amend']);
const diagnosticsCommands = new Set(['diagnostics.list']);
const gatewayCommands = new Set(['gateway.status', 'gateway.logs', 'gateway.logs.clear']);
const kernelCommands = new Set(['kernel.detect', 'kernel.recycle']);
const settingsCommands = new Set(['settings.get', 'settings.set']);
const policyCommands = new Set(['policy.save', 'policy.list']);
const usageCommands = new Set(['usage.summary']);
const agentCommands = new Set([
  'agent.get',
  'agent.updateBinding',
  'agent.list',
  'agent.create',
  'agent.listVersions',
  'agent.createVersion',
]);
const globalAgentCommands = new Set([
  'globalAgent.list',
  'globalAgent.create',
  'globalAgent.update',
  'globalAgent.delete',
  'globalAgent.listWorkspaceActivations',
  'globalAgent.setWorkspaceActivation',
]);
const teamCommands = new Set([
  'team.list',
  'team.create',
  'team.update',
  'team.delete',
  'team.startRun',
  'team.setRunStatus',
]);
const scheduledTaskCommands = new Set([
  'scheduledTask.create',
  'scheduledTask.list',
  'scheduledTask.update',
  'scheduledTask.delete',
  'scheduledTask.trigger',
  'scheduledTask.history',
]);
const activityCommands = new Set([
  'activity.listRuns',
  'activity.listExternalEvents',
  'activity.retryAnchor',
]);
const goalCommands = new Set(['goal.set', 'goal.get', 'goal.clear', 'goal.pause', 'goal.resume']);
const skillLocalCommands = new Set([
  'skill.local.scan',
  'skill.local.inspect',
  'skill.local.import',
]);
const skillMarketCommands = new Set(['skill.market.list', 'skill.market.install']);
const skillCommands = new Set([
  'skill.import',
  'skill.importRemote',
  'skill.list',
  'skill.get',
  'skill.delete',
  'skill.setEnabled',
]);
const mcpRegistryCommands = new Set([
  'mcp.register',
  'mcp.registerRemote',
  'mcp.list',
  'mcp.setEnabled',
  'mcp.delete',
]);
const mcpToolCommands = new Set([
  'mcp.policy.probe',
  'mcp.tool.request',
  'mcp.spawn.probe',
  'mcp.tool.call',
  'mcp.tools.refresh',
]);
const botChannelCommands = new Set([
  'bot.channel.get',
  'bot.channel.save',
  'bot.channel.test',
  'bot.channel.wechat.qr.request',
  'bot.channel.wechat.qr.check',
]);
const capabilityGovernanceCommands = new Set([
  'capability.workspace.list',
  'capability.workspace.setActive',
  'capability.governance.list',
  'capability.publishDraft.save',
  'capability.publishDraft.list',
  'capability.publishDraft.get',
  'capability.publishDraft.submit',
  'capability.organize.preview',
  'capability.organize.getLatest',
]);
const promptDesignCommands = new Set([
  'prompt.enhance',
  'prompt.enhance.cancel',
  'design.generate',
]);
const workspaceCommands = new Set([
  'workspace.create',
  'workspace.bindFolder',
  'workspace.list',
  'workspace.update',
  'workspace.delete',
]);
const taskCommands = new Set([
  'task.create',
  'task.list',
  'task.open',
  'task.search',
  'task.archive',
  'task.unarchive',
]);
const participationModeCommands = new Set(['task.setParticipationMode']);
const planCommands = new Set(['plan.draft', 'plan.revise', 'plan.listRevisions', 'plan.approve']);
const runControlCommands = new Set(['run.getGraph', 'run.pause', 'run.resume', 'run.cancel']);
const artifactCommands = new Set([
  'artifact.list',
  'artifact.getVersion',
  'artifact.compare',
  'artifact.selectVersion',
  'artifact.merge',
  'artifact.listConflicts',
  'artifact.resolveConflict',
]);
const providerCatalogCommands = new Set([
  'provider.create',
  'provider.update',
  'provider.list',
  'provider.reorder',
  'provider.delete',
]);
const providerCredentialCommands = new Set([
  'provider.addCredential',
  'provider.removeCredential',
  'provider.clearCredentials',
  'provider.revealCredential',
  'provider.updateCredential',
]);
const providerModelCommands = new Set([
  'provider.addModels',
  'provider.setModelPriorities',
  'provider.updateModel',
  'provider.removeModel',
]);
const providerDiscoveryCommands = new Set([
  'provider.discoverModels',
  'provider.probeModels',
  'provider.probeCapabilities',
  'provider.confirmCapabilities',
]);
const providerBalanceCommands = new Set(['provider.balance']);
const providerCcSwitchCommands = new Set([
  'provider.previewCcSwitchImport',
  'provider.importCcSwitch',
]);
const webSearchProviderCommands = new Set([
  'webSearch.providers.list',
  'webSearch.providers.save',
  'webSearch.providers.reorder',
  'webSearch.providers.test',
]);
const dataManagementCommands = new Set([
  'data.storageStats',
  'data.export',
  'data.import',
  'data.backup',
  'data.compactStorage',
  'data.cleanConversations',
  'data.cleanEmptyAttachmentDirectories',
]);
const schedulingCore = new Set([
  'apps/runtime/src/orchestration/scheduler.ts',
  'apps/runtime/src/orchestration/scheduler-ports.ts',
  'apps/runtime/src/orchestration/step-executor.ts',
  'apps/runtime/src/orchestration/production-step-executor-ports.ts',
]);

/** Source-only boundary checks, shared by the repository CLI and fixture tests. */
export function checkArchitectureSource(file, text) {
  const relative = file.replaceAll('\\', '/');
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  const errors = [];
  const report = (node, message) =>
    errors.push(
      `${relative}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`,
    );
  if (relative === 'packages/core/src/rework-policy.ts') {
    report(source, 'The obsolete Core review-policy compatibility module must not be restored.');
  }
  if (relative === obsoleteAbilitiesPageFile) {
    report(
      source,
      'Import AbilityCenterPage directly instead of restoring the compatibility module.',
    );
  }
  if (relative === obsoleteDesktopRefreshCoordinatorFile) {
    report(source, 'Use the shared RefreshCoordinator instead of restoring a Desktop copy.');
  }
  if (relative === obsoleteTelegramBotClientFile) {
    report(
      source,
      'Use the unified TelegramGateway instead of restoring the legacy polling client.',
    );
  }
  const checkDependency = (node, name) => {
    const resolved = name.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(relative), name))
      : name;
    if (
      relative.startsWith('packages/') &&
      (resolved.startsWith('apps/') ||
        /^@sync-think\/(desktop|runtime|website|cloud)(\/|$)/.test(name))
    )
      report(node, 'Reusable packages must not import applications.');
    if (
      relative.startsWith('apps/website/src/demo/') &&
      (resolved.startsWith('apps/desktop/') || /^@sync-think\/desktop(\/|$)/.test(name))
    ) {
      report(node, 'Website demo code must use the explicit desktop demo surface.');
    }
    if (
      relative === 'apps/desktop/src/renderer/shell/website-demo-surface.ts' &&
      resolved.startsWith('apps/website/')
    ) {
      report(node, 'The desktop demo surface must not depend on Website orchestration.');
    }
    if (relative.startsWith('apps/desktop/') && formerDesktopSharedUiModules.has(resolved)) {
      report(
        node,
        'Shared UI primitives must be consumed directly from ui-kit, not a Desktop compatibility module.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/renderer/shell/') &&
      resolved === obsoleteAbilitiesPageModule
    ) {
      report(node, 'Import abilities/AbilityCenterPage directly.');
    }
    if (
      relative === 'apps/desktop/src/renderer/shell/ShellApp.tsx' &&
      resolved === abilityCenterImplementationModule &&
      !ts.isImportDeclaration(node)
    ) {
      report(node, 'Lazy-load AbilityCenterPage through its narrow lazy entry.');
    }
    const infrastructure =
      /^@sync-think\/(storage|workers|adapters|secure-store)(\/|$)/.test(name) ||
      /^packages\/(storage|workers|adapters|secure-store)\//.test(resolved);
    if (
      (/^apps\/desktop\/src\/main\/conversation-(query|write|transient|approval|browser|management|routing|plan|ask)-handlers\.ts$/.test(
        relative,
      ) ||
        /^apps\/desktop\/src\/main\/browser-(profile|recording|workflow|handoff)-handlers\.ts$/.test(
          relative,
        ) ||
        relative === 'apps/desktop/src/main/desktop-command-handlers.ts' ||
        relative === 'apps/desktop/src/main/browser-extension-handlers.ts' ||
        relative === 'apps/desktop/src/main/approval-handlers.ts' ||
        relative === 'apps/desktop/src/main/memory-handlers.ts' ||
        relative === 'apps/desktop/src/main/context-packet-handlers.ts' ||
        relative === 'apps/desktop/src/main/diagnostics-handlers.ts' ||
        relative === 'apps/desktop/src/main/gateway-handlers.ts' ||
        relative === 'apps/desktop/src/main/kernel-handlers.ts' ||
        relative === 'apps/desktop/src/main/settings-handlers.ts' ||
        relative === 'apps/desktop/src/main/policy-handlers.ts' ||
        relative === 'apps/desktop/src/main/usage-handlers.ts' ||
        relative === 'apps/desktop/src/main/agent-handlers.ts' ||
        relative === 'apps/desktop/src/main/global-agent-handlers.ts' ||
        relative === 'apps/desktop/src/main/team-handlers.ts' ||
        relative === 'apps/desktop/src/main/scheduled-task-handlers.ts' ||
        relative === 'apps/desktop/src/main/activity-handlers.ts' ||
        relative === 'apps/desktop/src/main/goal-handlers.ts' ||
        relative === 'apps/desktop/src/main/skill-local-handlers.ts' ||
        relative === 'apps/desktop/src/main/skill-market-handlers.ts' ||
        relative === 'apps/desktop/src/main/skill-handlers.ts' ||
        relative === 'apps/desktop/src/main/mcp-registry-handlers.ts' ||
        relative === 'apps/desktop/src/main/mcp-tool-handlers.ts' ||
        relative === 'apps/desktop/src/main/bot-channel-handlers.ts' ||
        relative === 'apps/desktop/src/main/capability-governance-handlers.ts' ||
        relative === 'apps/desktop/src/main/prompt-design-handlers.ts' ||
        relative === 'apps/desktop/src/main/workspace-handlers.ts' ||
        relative === 'apps/desktop/src/main/task-handlers.ts' ||
        relative === 'apps/desktop/src/main/participation-mode-handlers.ts' ||
        relative === 'apps/desktop/src/main/plan-handlers.ts' ||
        relative === 'apps/desktop/src/main/run-control-handlers.ts' ||
        relative === 'apps/desktop/src/main/artifact-handlers.ts' ||
        relative === 'apps/desktop/src/main/provider-catalog-handlers.ts' ||
        relative === 'apps/desktop/src/main/provider-credential-handlers.ts' ||
        relative === 'apps/desktop/src/main/provider-model-handlers.ts' ||
        relative === 'apps/desktop/src/main/provider-discovery-handlers.ts' ||
        relative === 'apps/desktop/src/main/provider-balance-handlers.ts' ||
        relative === 'apps/desktop/src/main/provider-cc-switch-handlers.ts' ||
        relative === 'apps/desktop/src/main/web-search-provider-handlers.ts' ||
        relative === 'apps/desktop/src/main/data-management-handlers.ts') &&
      (infrastructure || name === 'electron' || /\/(index|runtime-client)\.[jt]s$/.test(resolved))
    ) {
      report(node, 'Main handler modules must use injected host ports.');
    }
    if (
      (/^apps\/desktop\/src\/(goal|skill|skill-local|skill-market|mcp-registry|mcp-tool|bot-channel|capability|prompt-design|workspace-lifecycle|task|participation-mode|plan|run-control|artifact|provider-catalog|provider-credential|provider-model|provider-discovery|provider-balance|provider-cc-switch|data-management)-payloads\.ts$/.test(
        relative,
      ) ||
        relative === 'apps/desktop/src/orchestration-payload-validation.ts' ||
        relative === 'apps/desktop/src/provider-payload-validation.ts') &&
      (infrastructure ||
        name === 'electron' ||
        resolved.startsWith('apps/desktop/src/main/') ||
        resolved.startsWith('apps/desktop/src/preload/') ||
        resolved.startsWith('apps/desktop/src/renderer/'))
    ) {
      report(node, 'Desktop payload parsers must remain host-independent contract leaves.');
    }
    if (/^packages\/(core|shared)\//.test(relative) && infrastructure) {
      report(node, 'Domain code must depend on ports, not infrastructure.');
    }
    if (schedulingCore.has(relative) && infrastructure) {
      report(node, 'Scheduling core must use neutral contracts and injected ports.');
    }
    if (
      relative === 'apps/runtime/src/orchestration/production-step-executor.ts' &&
      (/^@sync-think\/storage(\/|$)/.test(name) || resolved.startsWith('packages/storage/'))
    ) {
      report(node, 'Production step execution must use narrow ports for storage.');
    }
    if (
      /^apps\/runtime\/src\/(model-fallback-selection|conversation-model-routing|initial-run-model-binding|renderer-browser-command-bridge|desktop-waiting-projection|active-tool-approval|inactive-tool-approval|tool-approval-read-model|describe-image)\.ts$/.test(
        relative,
      ) &&
      (infrastructure ||
        /^apps\/runtime\/src\/(runtime|demo-run|persistence)\.[jt]s$/.test(resolved))
    ) {
      report(
        node,
        'Routing and approval boundaries must use narrow data and ports, not host or storage implementations.',
      );
    }
    if (
      relative === 'apps/runtime/src/scheduled-task-history-summary.ts' &&
      (infrastructure ||
        /^apps\/runtime\/src\/(runtime|demo-run|persistence)\.[jt]s$/.test(resolved))
    ) {
      report(node, 'Scheduled Task history summaries must remain pure and host-independent.');
    }
    if (
      relative === 'apps/runtime/src/kernel/platform-agent-store.ts' &&
      (infrastructure ||
        /^apps\/runtime\/src\/(runtime|demo-run|persistence)\.[jt]s$/.test(resolved))
    ) {
      report(
        node,
        'Platform Agent Store adapters must use narrow ports, not host implementations.',
      );
    }
    if (
      /^apps\/runtime\/src\/(goal-turn|task-plan-context|kernel-session-transcript)\.ts$/.test(
        relative,
      ) &&
      (infrastructure ||
        /^apps\/runtime\/src\/(runtime|demo-run|persistence)\.[jt]s$/.test(resolved))
    ) {
      report(
        node,
        'Goal and task-plan projections must remain pure and independent of Runtime state.',
      );
    }
    if (
      /^apps\/runtime\/src\/delegation-(execution|timeout-policy|admission|service|message-history|legacy-message-history|message-projection|history-query|projection)\.ts$/.test(
        relative,
      ) &&
      (infrastructure || /^apps\/runtime\/src\/(runtime|demo-run)\.[jt]s$/.test(resolved))
    ) {
      report(
        node,
        'Delegation execution must use narrow ports, not Runtime or storage implementations.',
      );
    }
    if (
      /^apps\/runtime\/src\/delegation-(message-history|legacy-message-history|message-projection|history-query|projection)\.ts$/.test(
        relative,
      ) &&
      /^apps\/runtime\/src\/delegation-(service|execution|admission)\.[jt]s$/.test(resolved)
    ) {
      report(node, 'Delegation history must not depend on its facade or execution use cases.');
    }
    if (
      relative === 'apps/runtime/src/delegation-history-query.ts' &&
      resolved === 'apps/runtime/src/delegation-message-history.js'
    ) {
      report(node, 'Delegation queries consume record ports, not message/card implementations.');
    }
    if (
      /^apps\/desktop\/src\/renderer\/shell\/(use-compose-request-queue|compose-send-request|use-conversation-compaction|use-compose-draft-recovery|submit-conversation-message|use-conversation-navigation|use-conversation-navigation-controller|use-message-virtual-window|use-conversation-transient-subscription|conversation-navigation-loader|conversation-message-merge|run-identity-projection|conversation-scroll-position)\.ts$/.test(
        relative,
      ) &&
      (infrastructure ||
        /\/(ChatView|runtime-client|index)\.[jt]sx?$/.test(resolved) ||
        resolved.startsWith('apps/desktop/src/main/') ||
        resolved.startsWith('apps/desktop/src/preload/'))
    ) {
      report(
        node,
        'Extracted Shell controllers must use contracts/callbacks, not UI or host implementations.',
      );
    }
    if (
      contractLeaves.has(relative) &&
      (name === 'react' ||
        name.endsWith('.tsx') ||
        /\/(ChatView|ComposerEditor|MessageTextContent|koffi-uia-driver|windows-uia-backend)\.js$/.test(
          name,
        ))
    ) {
      report(node, 'Contract leaves must not depend on their UI/driver implementations.');
    }
    if (
      relative.startsWith('apps/desktop/src/renderer/shell/') &&
      ((ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) ||
        ts.isImportTypeNode(node)) &&
      name === './ChatView.js'
    )
      report(node, 'Import chat data contracts from conversation-types, not ChatView.');
  };
  const visit = (node) => {
    const declaredName =
      ts.isFunctionDeclaration(node) && node.name
        ? node.name.text
        : ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
          ? node.name.text
          : (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) &&
              node.name &&
              ts.isIdentifier(node.name)
            ? node.name.text
            : undefined;
    if (relative === runtimeFile && declaredName && legacyTelegramRuntimeNames.has(declaredName)) {
      report(node, 'Keep Telegram lifecycle in BotChannelGatewayManager and TelegramGateway.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeProviderProjectionNames.has(declaredName)
    ) {
      report(node, 'Keep provider DTO projection in provider-catalog-projection.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeDesktopWaitingProjectionNames.has(declaredName)
    ) {
      report(node, 'Keep desktop waiting DTO projection in desktop-waiting-projection.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimePlatformAdapterNames.has(declaredName)
    ) {
      report(node, 'Keep platform Agent Store adaptation in kernel/platform-agent-store.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeScheduledTaskProjectionNames.has(declaredName)
    ) {
      report(node, 'Keep Scheduled Task history selection in scheduled-task-history-summary.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeProviderLookupNames.has(declaredName)
    ) {
      report(node, 'Keep Provider lookup and projection in provider-catalog-projection.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeProviderDiscoveryNames.has(declaredName)
    ) {
      report(node, 'Keep Provider discovery routing in provider-discovery-routing.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimePromptEnhancementNames.has(declaredName)
    ) {
      report(
        node,
        'Keep prompt enhancement payload parsing in Protocol and model selection in prompt-enhancement-model-selection.',
      );
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeArtifactContentNames.has(declaredName)
    ) {
      report(node, 'Keep Artifact content classification in artifact-content-policy.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeCcSwitchPathNames.has(declaredName)
    ) {
      report(node, 'Keep CC Switch import path selection in cc-switch-import-path.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeContextSnapshotCacheNames.has(declaredName)
    ) {
      report(
        node,
        'Keep conversation context snapshot storage in conversation-context-snapshot-cache.',
      );
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeRunKernelRegistryNames.has(declaredName)
    ) {
      report(node, 'Keep Run-to-Kernel persistence in run-kernel-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimePolicyScopeNames.has(declaredName)
    ) {
      report(node, 'Keep Policy scope validation and composition in policy-scope-service.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimePendingAskNames.has(declaredName)
    ) {
      report(node, 'Keep pending ask ownership and lifecycle in pending-ask-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeFormalPlanRevisionNames.has(declaredName)
    ) {
      report(node, 'Keep formal plan revision recovery in formal-plan-revision-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeScheduledTaskDispatchNames.has(declaredName)
    ) {
      report(node, 'Keep scheduled task dispatch state in scheduled-task-dispatch-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeContextAmendmentNames.has(declaredName)
    ) {
      report(
        node,
        'Keep conversation context amendment state in conversation-context-amendment-registry.',
      );
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeCompactBoundaryNames.has(declaredName)
    ) {
      report(node, 'Keep compact boundary recovery in conversation-compact-boundary-cache.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeDeadContextRunNames.has(declaredName)
    ) {
      report(node, 'Do not restore the write-only contextRunByThread state.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeDurableToolApprovalNames.has(declaredName)
    ) {
      report(node, 'Keep durable tool approval fallback state in durable-tool-approval-ledger.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeCapabilityUsageNames.has(declaredName)
    ) {
      report(node, 'Keep capability usage idempotency in capability-usage-recorder.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeAssistantTimelineNames.has(declaredName)
    ) {
      report(
        node,
        'Keep assistant timeline fingerprint state in assistant-timeline-change-tracker.',
      );
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimePlatformMcpRunNames.has(declaredName)
    ) {
      report(node, 'Keep per-run platform MCP state in platform-mcp-run-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeScheduledTaskRunNames.has(declaredName)
    ) {
      report(node, 'Keep scheduled task run state in scheduled-task-run-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimePromiseLifecycleNames.has(declaredName)
    ) {
      report(node, 'Keep in-flight Promise lifecycle state in in-flight-promise-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeExternalEventExecutionNames.has(declaredName)
    ) {
      report(node, 'Keep external event execution state in external-event-execution-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeAbortControllerNames.has(declaredName)
    ) {
      report(node, 'Keep keyed AbortController state in abort-controller-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeKernelToolProgressNames.has(declaredName)
    ) {
      report(node, 'Keep kernel tool progress state in kernel-tool-progress-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeExternalKernelSessionQueueNames.has(declaredName)
    ) {
      report(node, 'Keep keyed turn serialization in keyed-turn-queue.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeActiveRunNames.has(declaredName)
    ) {
      report(node, 'Keep active run ownership in active-run-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeCompletedDelegatedRunNames.has(declaredName)
    ) {
      report(node, 'Keep completed delegated run state in completed-delegated-run-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeLocalSkillWatchNames.has(declaredName)
    ) {
      report(node, 'Keep local Skill watcher lifecycle in local-skill-watch-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeMcpAuthConfigNames.has(declaredName)
    ) {
      report(node, 'Keep MCP auth configuration persistence in mcp-auth-config-repository.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeLocalSkillRefreshNames.has(declaredName)
    ) {
      report(node, 'Keep refresh generation coordination in @sync-think/shared.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeSubscriptionNames.has(declaredName)
    ) {
      report(node, 'Keep connection-owned stream state in owned-subscription-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeTransientStateNames.has(declaredName)
    ) {
      report(node, 'Keep per-thread transient state in conversation-transient-state-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeThreadVersionNames.has(declaredName)
    ) {
      report(node, 'Keep durable thread-version state in thread-version-projection.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeGoalExecutionStateNames.has(declaredName)
    ) {
      report(node, 'Keep Goal execution state in goal-execution-state-registry.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeKernelConversationSessionNames.has(declaredName)
    ) {
      report(node, 'Keep kernel session persistence in kernel-conversation-session-repository.');
    }
    if (
      relative === runtimeFile &&
      declaredName &&
      retiredRuntimeCatalogSummaryNames.has(declaredName)
    ) {
      report(node, 'Keep record-to-DTO catalog projection in summaries.');
    }
    if (declaredName && retiredTestOnlyRendererHelpers.get(relative)?.has(declaredName)) {
      report(node, 'Do not restore test-only compatibility helpers in production modules.');
    }
    if (
      pathContainmentConsumerPattern.test(relative) &&
      declaredName &&
      localPathContainmentNames.has(declaredName)
    ) {
      report(node, 'Use isPathWithinRoot from @sync-think/shared/node-paths.');
    }
    if (relative !== sharedAsciiControlOwner && declaredName === 'hasAsciiControlCharacter') {
      report(node, 'Use hasAsciiControlCharacter from @sync-think/shared.');
    }
    if (relative !== sharedRecordOwner && declaredName === 'isRecord') {
      report(node, 'Use isRecord from @sync-think/shared/value-validation.');
    }
    if (
      relative.startsWith('apps/desktop/src/renderer/shell/') &&
      declaredName === 'formatTokens'
    ) {
      report(node, 'Use the semantic compact-number presentation policies.');
    }
    if (relative === abilityCenterImplementationFile && declaredName === 'SkillSurface') {
      report(node, 'The retired legacy SkillSurface must not be restored.');
    }
    if (secretInputPolicyHosts.has(relative) && declaredName === 'SecretInput') {
      report(node, 'Compose SecretInputControl with a host-specific secret policy.');
    }
    if (
      toggleControlHosts.has(relative) &&
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === 'button' &&
      node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          ts.isIdentifier(attribute.name) &&
          attribute.name.text === 'role' &&
          attribute.initializer &&
          ts.isStringLiteral(attribute.initializer) &&
          attribute.initializer.text === 'switch',
      ) &&
      !node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          ts.isIdentifier(attribute.name) &&
          attribute.name.text === 'className' &&
          attribute.initializer &&
          ts.isStringLiteral(attribute.initializer) &&
          compositeSwitchClassesByHost.get(relative)?.has(attribute.initializer.text),
      )
    ) {
      report(node, 'Compose ToggleControl with host-specific styling.');
    }
    if (binaryByteScalingConsumers.has(relative) && declaredName === 'formatBytes') {
      report(node, 'Use scaleBinaryBytes and a host-specific presentation policy.');
    }
    if (
      binaryByteScalingConsumers.has(relative) &&
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.SlashToken &&
      ts.isNumericLiteral(node.right) &&
      node.right.text === '1024'
    ) {
      report(node, 'Keep binary byte scaling in @sync-think/shared.');
    }
    if (declaredName && legacyImageValidationNames.has(declaredName)) {
      report(node, 'Use @sync-think/shared/node-image-validation.');
    }
    if (vendorLoaderAdapterPattern.test(relative) && declaredName === 'vendorPromise') {
      report(node, 'Keep vendor script caching in vendor-script-loader.');
    }
    if (
      relative === rendererSkillMarketFile &&
      declaredName === 'SKILL_MARKET' &&
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      report(node, 'Derive the Renderer Skill market fallback from the Protocol catalog.');
    }
    if (relative === rendererSkillMarketFile && declaredName === 'makeSkillSource') {
      report(
        node,
        'Keep installable Skill package contents in Runtime, not Renderer fallback data.',
      );
    }
    if (
      relative === runtimeSkillMarketFile &&
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      duplicatedSkillMarketSummaryFields.has(node.name.text) &&
      ts.isObjectLiteralExpression(node.parent) &&
      ts.isArrayLiteralExpression(node.parent.parent) &&
      ts.isVariableDeclaration(node.parent.parent.parent) &&
      ts.isIdentifier(node.parent.parent.parent.name) &&
      node.parent.parent.parent.name.text === 'AUTHOR_SKILL_PACKAGES'
    ) {
      report(node, 'Derive Runtime Skill market summaries from the Protocol catalog.');
    }
    if (
      vendorLoaderAdapterPattern.test(relative) &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'document' &&
      node.expression.name.text === 'createElement' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === 'script'
    ) {
      report(node, 'Keep vendor script injection in vendor-script-loader.');
    }
    if (
      browserPayloadAdapterPattern.test(relative) &&
      ts.isFunctionDeclaration(node) &&
      node.name &&
      browserPayloadRuleNames.has(node.name.text)
    ) {
      report(node, 'Browser payload rules must remain in @sync-think/protocol/browser-payloads.');
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      checkDependency(node, node.moduleSpecifier.text);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      checkDependency(node, node.argument.literal.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      checkDependency(node, node.arguments[0].text);
    }
    if (
      relative.startsWith('apps/desktop/src/renderer/shell/') &&
      relative !== 'apps/desktop/src/renderer/shell/skill-catalog-loader.ts' &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'listSkills'
    ) {
      report(node, 'Renderer Skill catalog reads must use the shared skill-catalog-loader.');
    }
    if (
      relative.startsWith('apps/desktop/src/renderer/shell/') &&
      relative !== 'apps/desktop/src/renderer/shell/mcp-catalog-loader.ts' &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'listMcpServers'
    ) {
      report(node, 'Renderer MCP catalog reads must use the shared mcp-catalog-loader.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      [
        'task.appendMessage',
        'message.attachImages',
        'conversation.listMessages',
        'conversation.getContextStatus',
        'conversation.sendMessage',
        'conversation.compact',
        'conversation.listNavigation',
        'conversation.getRunProcess',
        'conversation.listRunTimeline',
        'conversation.readContent',
        'conversation.readFileDiff',
        'conversation.listFileChanges',
        'conversation.taskPlanHistory',
        'conversation.decideToolApproval',
        'conversation.listPendingToolApprovals',
        'conversation.submitBrowserResult',
        'conversation.list',
        'conversation.create',
        'conversation.rename',
        'conversation.setPinned',
        'conversation.setArchived',
        'conversation.delete',
        'conversation.setExecutionMode',
        'conversation.setInteractionMode',
        'conversation.setContextWindowOverride',
        'conversation.upgradeTrack',
        'conversation.rebindTarget',
        'conversation.plan.submit',
        'conversation.plan.get',
        'conversation.plan.approve',
        'conversation.plan.revise',
        'conversation.plan.cancel',
        'conversation.ask.answer',
        'conversation.ask.cancel',
        'conversation.ask.pending',
      ].includes(node.arguments[0].text)
    ) {
      report(node, 'Use requestConversation so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      browserProfileCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestBrowserProfile so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      providerBalanceCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestProviderBalance so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      providerCcSwitchCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestProviderCcSwitch so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      webSearchProviderCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestWebSearchProvider so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      dataManagementCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestDataManagement so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      providerModelCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestProviderModel so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      providerDiscoveryCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestProviderDiscovery so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      desktopCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestDesktopCommand so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      browserExtensionCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestBrowserExtension so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      approvalCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestApproval so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      memoryCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestMemory so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      contextPacketCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestContextPacket so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      diagnosticsCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestDiagnostics so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      gatewayCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestGateway so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      kernelCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestKernel so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      settingsCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestSettings so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      policyCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestPolicy so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      usageCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestUsage so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      agentCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestAgent so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      globalAgentCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestGlobalAgent so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      teamCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestTeam so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      scheduledTaskCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestScheduledTask so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      activityCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestActivity so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      goalCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestGoal so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      skillLocalCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestSkillLocal so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      skillMarketCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestSkillMarket so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      skillCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestSkill so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      mcpRegistryCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestMcpRegistry so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      mcpToolCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestMcpTool so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      botChannelCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestBotChannel so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      capabilityGovernanceCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestCapabilityGovernance so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      promptDesignCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestPromptDesign so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      workspaceCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestWorkspace so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      taskCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestTask so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      participationModeCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestParticipationMode so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      planCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestPlan so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      runControlCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestRunControl so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      artifactCommands.has(node.arguments[0].text)
    ) {
      report(node, 'Use requestArtifact so the command determines payload and response types.');
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      providerCatalogCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestProviderCatalog so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      providerCredentialCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestProviderCredential so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      browserHandoffCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestBrowserHandoff so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      browserWorkflowCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestBrowserWorkflow so the command determines payload and response types.',
      );
    }
    if (
      relative.startsWith('apps/desktop/src/main/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'request' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      browserRecordingCommands.has(node.arguments[0].text)
    ) {
      report(
        node,
        'Use requestBrowserRecording so the command determines payload and response types.',
      );
    }
    if (
      relative === 'packages/storage/src/runtime-state-store.ts' &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'projectEvents'
    ) {
      report(
        node,
        'The event transaction coordinator must call transaction-bound projections, not nested transaction entry points.',
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}
