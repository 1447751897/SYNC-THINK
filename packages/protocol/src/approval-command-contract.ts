import type {
  DecideApprovalPayload,
  DecideApprovalResponse,
  EnqueueApprovalPayload,
  EnqueueApprovalResponse,
  EvaluateApprovalPayload,
  EvaluateApprovalResponse,
  ListApprovalsPayload,
  ListApprovalsResponse,
} from './commands.js';

/** Approval Center RPCs bind each command to its request and response payload. */
export interface ApprovalCommandContract {
  'approval.list': {
    request: ListApprovalsPayload;
    response: ListApprovalsResponse;
  };
  'approval.evaluate': {
    request: EvaluateApprovalPayload;
    response: EvaluateApprovalResponse;
  };
  'approval.enqueue': {
    request: EnqueueApprovalPayload;
    response: EnqueueApprovalResponse;
  };
  'approval.decide': {
    request: DecideApprovalPayload;
    response: DecideApprovalResponse;
  };
}

export type ApprovalCommand = keyof ApprovalCommandContract;
export type ApprovalCommandRequest<K extends ApprovalCommand> =
  ApprovalCommandContract[K]['request'];
export type ApprovalCommandResponse<K extends ApprovalCommand> =
  ApprovalCommandContract[K]['response'];
