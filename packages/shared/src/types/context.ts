import type { AgentVersionId, ModelId, CredentialRefId, SkillVersionId, RunId, StepId, TaskId } from './ids.js';
import type { FailureClass } from './enums.js';

// Context Packet — fed to every model call. Only relevant subset of sources.
// The runtime cannot transfer a model's hidden reasoning; only app-owned facts.
export interface ContextPacket {
  id: string;
  taskId: TaskId;
  runId?: RunId;
  stepId?: StepId;
  agentVersionId: AgentVersionId;
  modelId: ModelId;
  credentialRefId?: CredentialRefId;
  includedSources: ContextSourceRef[];
  excludedSources: ContextSourceRef[];
  compressedSectionIds: string[];
  crossTaskRefs: string[];
  tokenEstimate: number;
  proofHash: string;
  createdAt: string;
}

export interface ContextSourceRef {
  id: string;
  kind:
    | 'task-goal'
    | 'task-status'
    | 'constraint'
    | 'acceptance-criteria'
    | 'decision'
    | 'project-memory'
    | 'agent-instructions'
    | 'output-contract'
    | 'skill-definition'
    | 'tool-schema'
    | 'message-excerpt'
    | 'file-excerpt'
    | 'artifact-version'
    | 'review-evidence'
    | 'unresolved-issue'
    | 'cross-task-ref';
  tokenEstimate: number;
}

// Context Manifest — user-inspectable record of packet construction (§10.3).
export interface ContextManifest {
  packetId: string;
  included: ContextSourceRef[];
  excluded: ContextSourceRef[];
  summaries: { sourceId: string; summary: string }[];
  truncations: { sourceId: string; reason: string; beforeTokens: number; afterTokens: number }[];
  crossTaskRefs: string[];
  agentVersionId: AgentVersionId;
  skillVersionIds: SkillVersionId[];
  policyVersion?: number;
  evidenceRefsForMemory: string[];
}

export interface MemoryChange {
  id: string;
  taskId: TaskId;
  additions: MemoryEntry[];
  modifications: MemoryEntry[];
  deprecations: string[];
  evidenceRefs: string[];
  targetScope: 'task' | 'project' | 'global';
  confidence: number;
  unresolvedAmbiguity?: string;
  approvalState: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  targetScope: 'task' | 'project' | 'global';
}

export interface ProviderCallDescriptor {
  modelId: ModelId;
  credentialRefId: CredentialRefId;
  agentVersionId: AgentVersionId;
  packetId: string;
  expectedFailureClasses?: FailureClass[];
}
