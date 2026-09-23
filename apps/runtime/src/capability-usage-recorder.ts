export type CapabilityUsageType = 'skill' | 'mcp';
export type CapabilityUsageOutcome = 'success' | 'failed' | 'cancelled';

export interface CapabilityUsageRecordInput {
  id: string;
  capabilityType: CapabilityUsageType;
  capabilityId: string;
  workspaceId: string;
  agentId?: string;
  agentVersionId?: string;
  runId?: string;
  outcome: CapabilityUsageOutcome;
  contextTokens?: number;
}

export interface CapabilityUsageEventPort {
  appendUsageEvent(input: CapabilityUsageRecordInput): unknown;
}

export class CapabilityUsageRecorder {
  private readonly recordedKeys = new Set<string>();

  constructor(private readonly events?: CapabilityUsageEventPort) {}

  record(input: CapabilityUsageRecordInput): boolean {
    if (!this.events || this.recordedKeys.has(input.id)) return false;
    this.events.appendUsageEvent(input);
    this.recordedKeys.add(input.id);
    return true;
  }
}
