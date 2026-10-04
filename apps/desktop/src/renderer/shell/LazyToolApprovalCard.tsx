import { lazy, Suspense, type ComponentProps } from 'react';
export type { PendingToolApproval } from './tool-approval-types.js';

// Approval details are needed only when a real request is pending, not on every app launch.
const ApprovalCard = lazy(() => import('./ToolApprovalCard.js').then(module => ({ default: module.ToolApprovalCard })));
type Props = ComponentProps<typeof import('./ToolApprovalCard.js').ToolApprovalCard>;
export function ToolApprovalCard(props: Props) {
  return <Suspense fallback={<section className="shell-composer-tool-approval shell-beui-approval" role="status"><p className="shell-beui-approval__description">正在读取审批提案…</p></section>}><ApprovalCard {...props} /></Suspense>;
}
