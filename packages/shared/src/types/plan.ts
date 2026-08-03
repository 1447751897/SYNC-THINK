import type {
  AgentVersionId,
  ModelId,
  PlanId,
  PlanRevisionId,
  StepId,
  TaskId,
} from './ids.js';
import type { ImageGenerationConfig } from '../image-generation.js';

export type PlanStepKind = 'execution' | 'merge';

export interface PlanStepDraft {
  /** Stable logical ID used to diff revisions and to create the Run Step. */
  id: StepId;
  /** Defaults to execution only when decoding a legacy revision or older client payload. */
  kind?: PlanStepKind;
  title: string;
  instructions: string;
  /** Exact immutable AgentVersion selected by the plan author. */
  agentVersionId: AgentVersionId;
  /** Optional exact per-Step model override. */
  modelOverrideId?: ModelId;
  /** Frozen image generation parameters; absent means the legacy defaults. */
  imageGeneration?: ImageGenerationConfig;
  dependsOn: StepId[];
}

export type PlanStepChangedField =
  | 'kind'
  | 'title'
  | 'instructions'
  | 'agentVersionId'
  | 'modelOverrideId'
  | 'imageGeneration'
  | 'dependsOn'
  | 'planOrder';

export interface PlanStepChange {
  id: StepId;
  before: PlanStepDraft;
  after: PlanStepDraft;
  changedFields: PlanStepChangedField[];
  beforePlanOrder: number;
  afterPlanOrder: number;
}

export interface PlanDiff {
  added: PlanStepDraft[];
  removed: PlanStepDraft[];
  changed: PlanStepChange[];
}

export type PlanRevisionState = 'draft' | 'approved' | 'superseded';

export interface PlanRevision {
  id: PlanRevisionId;
  planId: PlanId;
  taskId: TaskId;
  revision: number;
  title: string;
  steps: PlanStepDraft[];
  diffFromPrevious: PlanDiff;
  state: PlanRevisionState;
  createdAt: string;
  approvedAt?: string;
}
