import type {
  AgentVersionId,
  CapabilityTag,
  CredentialGroupId,
  CredentialRefId,
  ContextEpochRecord,
  GetOrCreateContextEpochInput,
  JsonValue,
  ModelId,
  ProductionExecutionFence,
  ProductionExecutionResult,
  ProtocolFamily,
  ProviderExecutionReservation,
  ProviderId,
  Run,
  RunGraph,
  RunId,
  TaskId,
  WorkspaceId,
} from '@sync-think/shared';

/** Run state needed while executing one production step. */
export interface ProductionStepExecutionRuns {
  getRun(runId: RunId): Run | undefined;
  getGraph(runId: RunId): RunGraph | undefined;
}

export interface ProductionStepExecutionTask {
  workspaceId: WorkspaceId;
}

export interface ProductionStepExecutionWorkspace {
  folderPath?: string;
}

/** Workspace binding needed by tools and browser handoffs. */
export interface ProductionStepExecutionWorkspaces {
  getTask(taskId: TaskId): ProductionStepExecutionTask | undefined;
  getWorkspace(workspaceId: WorkspaceId): ProductionStepExecutionWorkspace | undefined;
}

export interface ProductionStepExecutionAgent {
  id: AgentVersionId;
  defaultModelId: ModelId;
  fallbackModelIds: ModelId[];
  pauseOnFailure: boolean;
  defaultCredentialGroupId: CredentialGroupId;
  pinnedCredentialRefId?: CredentialRefId;
  permissions: { browser: string[] };
  skillVersionIds: string[];
  developerInstructions: string;
  inputContract: string;
  outputContract: string;
}

/** Immutable AgentVersion fields consumed by production execution. */
export interface ProductionStepExecutionAgents {
  getVersion(agentVersionId: AgentVersionId): ProductionStepExecutionAgent | undefined;
}

export interface ProductionStepExecutionModel {
  id: ModelId;
  providerId: ProviderId;
  providerModelId: string;
  protocol: ProtocolFamily;
  capabilities: CapabilityTag[];
  limitsJson?: string;
  capabilitiesConfirmed: boolean;
  visionCapability?: boolean;
  visionProbeReason?: string;
  visionManualOverride?: boolean;
}

export interface ProductionStepExecutionProvider {
  id: ProviderId;
  baseUrl: string;
}

export interface ProductionStepExecutionCredential {
  id: CredentialRefId;
  credentialGroupId: CredentialGroupId;
}

/** Provider catalog and credential routing reads needed for one execution. */
export interface ProductionStepExecutionProviders {
  getModel(modelId: ModelId | string): ProductionStepExecutionModel | undefined;
  getProvider(providerId: ProviderId): ProductionStepExecutionProvider | undefined;
  getCredentialRef(credentialRefId: CredentialRefId | string):
    | ProductionStepExecutionCredential
    | undefined;
  getFirstCredentialInGroup(groupId: CredentialGroupId | string):
    | ProductionStepExecutionCredential
    | undefined;
  getPrimaryCredentialRef(providerId: ProviderId | string):
    | ProductionStepExecutionCredential
    | undefined;
  getProviderIdForCredentialGroup(groupId: CredentialGroupId | string): ProviderId | undefined;
  getCredentialStoreHandle(credentialRefId: CredentialRefId | string): string | undefined;
}

export interface ProductionStepExecutionSkillMetadata {
  id: string;
  enabled: boolean;
  archivedAt?: string;
}

export interface ProductionStepExecutionSkill extends ProductionStepExecutionSkillMetadata {
  name: string;
  version: string;
  description: string;
  body: string;
  contentFingerprint: string;
  allowedTools: string[];
  hasScripts: boolean;
}

/** Skill authorization and prompt-source reads needed for one execution. */
export interface ProductionStepExecutionSkills {
  getVersionMetadata(id: string): ProductionStepExecutionSkillMetadata | undefined;
  getVersion(id: string): ProductionStepExecutionSkill | undefined;
  isPermissionApproved(skillVersionId: string): boolean;
}

/** Agent context epoch lifecycle needed before a provider call. */
export interface ProductionStepExecutionAgentContexts {
  getOrCreateEpoch(input: GetOrCreateContextEpochInput): ContextEpochRecord;
}

type ProviderExecutionKey = ProductionExecutionFence & { idempotencyKey: string };

/** Idempotent provider-call reservation lifecycle used by production execution. */
export interface ProductionStepExecutionReservations {
  getCompletedProviderExecution(
    input: ProviderExecutionKey,
  ): ProviderExecutionReservation | undefined;
  reserveProviderExecution(
    input: ProviderExecutionKey & { now?: string },
  ): ProviderExecutionReservation & { created: boolean };
  releaseProviderExecution(
    input: ProviderExecutionKey & { now?: string },
  ): ProviderExecutionReservation;
  checkpointProviderExecution(
    input: ProviderExecutionKey & { checkpoint: JsonValue; now?: string },
  ): ProviderExecutionReservation;
  completeProviderExecution(
    input: ProviderExecutionKey & { result: ProductionExecutionResult; now?: string },
  ): ProviderExecutionReservation;
}
