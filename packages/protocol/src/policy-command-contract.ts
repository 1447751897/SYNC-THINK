import type {
  ListPoliciesPayload,
  ListPoliciesResponse,
  SavePolicyPayload,
  SavePolicyResponse,
} from './commands.js';

/** Scoped policy RPCs bind each command to its request and response payload. */
export interface PolicyCommandContract {
  'policy.save': {
    request: SavePolicyPayload;
    response: SavePolicyResponse;
  };
  'policy.list': {
    request: ListPoliciesPayload;
    response: ListPoliciesResponse;
  };
}

export type PolicyCommand = keyof PolicyCommandContract;
export type PolicyCommandRequest<K extends PolicyCommand> = PolicyCommandContract[K]['request'];
export type PolicyCommandResponse<K extends PolicyCommand> = PolicyCommandContract[K]['response'];
