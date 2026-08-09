import type { Feature } from '@sync-think/protocol';
import type { Event } from '@sync-think/shared';

export const CAPABILITY_RUNTIME_IPC_CHANNELS = {
  listWorkspaceActivations: 'runtime:capability-workspace-list',
  setWorkspaceActive: 'runtime:capability-workspace-set-active',
  listGovernance: 'runtime:capability-governance-list',
  savePublishDraft: 'runtime:capability-publish-draft-save',
  listPublishDrafts: 'runtime:capability-publish-draft-list',
  getPublishDraft: 'runtime:capability-publish-draft-get',
  submitPublishDraft: 'runtime:capability-publish-draft-submit',
  previewOrganize: 'runtime:capability-organize-preview',
  getLatestOrganize: 'runtime:capability-organize-get-latest',
} as const;

export interface RuntimeHealthyStatus {
  readonly ok: true;
  readonly runtimePid: number;
  readonly uptimeMs: number;
  readonly protocolVersion: number;
  readonly features: readonly Feature[];
  readonly inFlightRuns: number;
  readonly inFlightRunIds: readonly string[];
  readonly eventSequence: number;
}

export interface RuntimeUnhealthyStatus {
  readonly ok: false;
  readonly error: {
    readonly code: string;
  };
}

export type RuntimeHealth = RuntimeHealthyStatus | RuntimeUnhealthyStatus;

export interface RuntimeConnectResult {
  readonly health: RuntimeHealth;
  readonly snapshot: readonly Event[];
}

export type RuntimeConnectFailureCode =
  | 'runtime.unavailable'
  | 'runtime.authentication-failed'
  | 'runtime.protocol-error'
  | 'runtime.permission-denied'
  | 'runtime.request-rejected'
  | 'desktop.bridge-error';

export interface RuntimeConnectFailure {
  readonly code: RuntimeConnectFailureCode;
  readonly retryable: boolean;
}

export type RuntimeConnectOutcome =
  | { readonly ok: true; readonly result: RuntimeConnectResult }
  | { readonly ok: false; readonly error: RuntimeConnectFailure };
