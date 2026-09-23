import type {
  AgentVersionId,
  RunId,
  StepId,
} from './ids.js';
import type { ArtifactVersionStatus, JsonValue } from './artifact.js';
import type { ProviderRequestUsage } from './usage.js';

interface ProductionArtifactOutputBase {
  artifactName: string;
  mimeType: string;
  status: ArtifactVersionStatus;
  metadata?: Record<string, JsonValue>;
}

export type ProductionArtifactOutput = ProductionArtifactOutputBase &
  (
    | { content: string; contentRef?: never; contentHash?: string }
    | { content?: never; contentRef: string; contentHash: string }
  );

export interface ProductionExecutionResult {
  outputVersions: ProductionArtifactOutput[];
  providerUsages?: ProviderRequestUsage[];
}

export interface ProductionExecutionFence {
  runId: RunId;
  stepId: StepId;
  agentVersionId: AgentVersionId;
  ownerId: string;
  executionAttempt: number;
}

export interface ProviderExecutionReservation extends ProductionExecutionFence {
  idempotencyKey: string;
  executionOwnerId: string;
  state: 'started' | 'released' | 'completed';
  result?: ProductionExecutionResult;
  checkpoint?: JsonValue;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface McpActionExecutionIntent extends ProductionExecutionFence {
  executionOwnerId: string;
  actionDigest: string;
  state: 'intent' | 'started' | 'completed';
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}
