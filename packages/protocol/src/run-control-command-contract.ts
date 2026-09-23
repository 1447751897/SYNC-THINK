import type {
  CancelOrchestrationRunResponse,
  CancelRunPayload,
  OrchestrationRunMutationPayload,
  PauseResumeCancelResponse,
  PauseRunResponse,
  ResumeRunResponse,
  RunGetGraphPayload,
  RunGetGraphResponse,
} from './commands.js';

/** Run graph and lifecycle control RPCs. `run.cancel` is shape-overloaded by Runtime. */
export interface RunControlCommandContract {
  'run.getGraph': {
    request: RunGetGraphPayload;
    response: RunGetGraphResponse;
  };
  'run.pause': {
    request: OrchestrationRunMutationPayload;
    response: PauseRunResponse;
  };
  'run.resume': {
    request: OrchestrationRunMutationPayload;
    response: ResumeRunResponse;
  };
  'run.cancel': {
    request: CancelRunPayload;
    response: PauseResumeCancelResponse | CancelOrchestrationRunResponse;
  };
}

export type RunControlCommand = keyof RunControlCommandContract;
export type RunControlCommandRequest<K extends RunControlCommand> =
  RunControlCommandContract[K]['request'];
export type RunControlCommandResponse<K extends RunControlCommand> =
  RunControlCommandContract[K]['response'];
