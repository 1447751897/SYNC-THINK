import type {
  PlanApprovePayload,
  PlanApproveResponse,
  PlanDraftPayload,
  PlanDraftResponse,
  PlanListRevisionsPayload,
  PlanListRevisionsResponse,
  PlanRevisePayload,
  PlanReviseResponse,
} from './commands.js';

/** Immutable plan revision lifecycle RPCs, excluding run execution control. */
export interface PlanCommandContract {
  'plan.draft': {
    request: PlanDraftPayload;
    response: PlanDraftResponse;
  };
  'plan.revise': {
    request: PlanRevisePayload;
    response: PlanReviseResponse;
  };
  'plan.listRevisions': {
    request: PlanListRevisionsPayload;
    response: PlanListRevisionsResponse;
  };
  'plan.approve': {
    request: PlanApprovePayload;
    response: PlanApproveResponse;
  };
}

export type PlanCommand = keyof PlanCommandContract;
export type PlanCommandRequest<K extends PlanCommand> = PlanCommandContract[K]['request'];
export type PlanCommandResponse<K extends PlanCommand> = PlanCommandContract[K]['response'];
