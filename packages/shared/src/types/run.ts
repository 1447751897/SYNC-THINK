import type {
  AgentVersionId,
  ModelId,
  PlanRevisionId,
  RunId,
  StepId,
  TaskId,
  WorkflowVersionId,
} from './ids.js';
import type { RunState } from './enums.js';
import type { PlanStepKind } from './plan.js';

export interface Run {
  id: RunId;
  taskId: TaskId;
  state: RunState;
  /** Exact immutable PlanRevision pinned when this Run is approved. */
  planRevisionId: PlanRevisionId;
  workflowVersionId?: WorkflowVersionId;
  createdAt: string;
  updatedAt: string;
  /** Steps that belong to this run; IDs stable across retries & recovery. */
  stepIds: StepId[];
}

export interface Step {
  id: StepId;
  runId: RunId;
  kind: PlanStepKind;
  /** Agent version that executed this step; historical runs reference exact version. */
  agentVersionId: AgentVersionId;
  /** Stable across retries and recovery. */
  retryOfStepId?: StepId;
  /** DAG dependency edges (IDs of steps that must complete first). */
  dependsOn: StepId[];
  /** Stable order from the approved PlanRevision. */
  planOrder?: number;
  title?: string;
  instructions?: string;
  /** Exact per-Step override; absence resolves through the pinned AgentVersion. */
  modelOverrideId?: ModelId;
  state: import('./enums.js').StepState;
  retries: number;
  /** Idempotency marker for safe re-execution on recovery (§20 rule 2). */
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}
