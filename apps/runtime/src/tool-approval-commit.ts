import type { ToolApprovalScope } from '@sync-think/protocol';
import type { ToolApprovalPolicy, ToolApprovalPolicyInput } from './tool-approval-policy.js';

export function commitToolApprovalDecision<Result>(input: {
  policy: ToolApprovalPolicy;
  request: ToolApprovalPolicyInput;
  decision: 'approve' | 'deny';
  scope: ToolApprovalScope;
  runTransaction?: (work: () => Result) => Result;
  persistDecision: () => Result;
}): Result {
  const remember = input.decision === 'approve' && input.scope !== 'once';
  const grant = remember
    ? input.policy.prepareRemember({ ...input.request, scope: input.scope })
    : undefined;
  if (remember && !grant) throw new Error('当前工具不支持此授权范围');
  if (grant?.persistentApp && !input.runTransaction) {
    throw new Error('Persistent tool approval requires a shared transaction');
  }
  const persist = () => {
    grant?.persist();
    return input.persistDecision();
  };
  const result = input.runTransaction ? input.runTransaction(persist) : persist();
  grant?.activate();
  return result;
}
