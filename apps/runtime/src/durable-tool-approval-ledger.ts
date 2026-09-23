import type { Event, RunId } from '@sync-think/shared';
import {
  projectToolApprovalStates,
  rememberToolApprovalEvent,
  type DurableToolApprovalState,
} from './tool-approval-read-model.js';

export type DurableToolApprovalEventScope =
  { threadId: string; runId?: RunId } | { approvalId: string };

export interface DurableToolApprovalEventPort {
  listEvents(scope: DurableToolApprovalEventScope): readonly Event[];
}

export class DurableToolApprovalLedger {
  private readonly fallbackStates = new Map<string, DurableToolApprovalState>();

  constructor(private readonly events?: DurableToolApprovalEventPort) {}

  list(scope: DurableToolApprovalEventScope): Map<string, DurableToolApprovalState> {
    if (this.events) return projectToolApprovalStates(this.events.listEvents(scope));
    return new Map(
      [...this.fallbackStates].filter(([approvalId, state]) => {
        if ('approvalId' in scope) return approvalId === scope.approvalId;
        return (
          state.requested.payload.threadId === scope.threadId &&
          (!scope.runId || (state.requested.runId ?? state.requested.payload.runId) === scope.runId)
        );
      }),
    );
  }

  remember(event: Event): void {
    if (!this.events) rememberToolApprovalEvent(this.fallbackStates, event);
  }
}
