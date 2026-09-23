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

export const PROMPT_DESIGN_RUNTIME_IPC_CHANNELS = {
  enhancePrompt: 'runtime:prompt-enhance',
  cancelPromptEnhancement: 'runtime:prompt-enhance-cancel',
  generateDesign: 'runtime:design-generate',
} as const;

export const WORKSPACE_RUNTIME_IPC_CHANNELS = {
  create: 'runtime:workspace-create',
  bindFolder: 'runtime:workspace-bind-folder',
  list: 'runtime:workspace-list',
  update: 'runtime:workspace-update',
  delete: 'runtime:workspace-delete',
} as const;

export const TASK_RUNTIME_IPC_CHANNELS = {
  create: 'runtime:task-create',
  list: 'runtime:task-list',
  open: 'runtime:task-open',
  search: 'runtime:task-search',
  archive: 'runtime:task-archive',
  unarchive: 'runtime:task-unarchive',
} as const;

export const PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS = {
  set: 'runtime:mode-set',
} as const;

export const PLAN_RUNTIME_IPC_CHANNELS = {
  create: 'runtime:plan-create',
  revise: 'runtime:plan-revise',
  listRevisions: 'runtime:plan-list',
  approve: 'runtime:plan-approve',
} as const;

export const RUN_CONTROL_RUNTIME_IPC_CHANNELS = {
  cancelConversation: 'runtime:run-cancel',
  getGraph: 'runtime:run-graph',
  pause: 'runtime:orchestration-run-pause',
  resume: 'runtime:orchestration-run-resume',
  cancelOrchestration: 'runtime:orchestration-run-cancel',
} as const;

export const ARTIFACT_RUNTIME_IPC_CHANNELS = {
  list: 'runtime:artifact-list',
  imagePreview: 'runtime:artifact-image-preview',
  compare: 'runtime:artifact-compare',
  selectVersion: 'runtime:artifact-select',
  merge: 'runtime:artifact-merge',
  listConflicts: 'runtime:artifact-conflict-list',
  resolveConflict: 'runtime:artifact-conflict-resolve',
} as const;

export const PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS = {
  create: 'runtime:provider-create',
  update: 'runtime:provider-update',
  list: 'runtime:provider-list',
  reorder: 'runtime:provider-reorder',
  delete: 'runtime:provider-delete',
} as const;

export const PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS = {
  add: 'runtime:provider-add-credential',
  remove: 'runtime:provider-remove-credential',
  clear: 'runtime:provider-clear-credentials',
  reveal: 'runtime:provider-reveal-credential',
  update: 'runtime:provider-update-credential',
} as const;

export const PROVIDER_MODEL_RUNTIME_IPC_CHANNELS = {
  add: 'runtime:provider-add-models',
  setPriorities: 'runtime:provider-set-model-priorities',
  update: 'runtime:provider-update-model',
  remove: 'runtime:provider-remove-model',
} as const;

export const PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS = {
  discoverModels: 'runtime:provider-discover',
  probeModels: 'runtime:provider-probe-models',
  probeCapabilities: 'runtime:provider-probe-capabilities',
  confirmCapabilities: 'runtime:provider-confirm-capabilities',
} as const;

export const PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS = {
  query: 'runtime:provider-balance',
} as const;

export const PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS = {
  preview: 'runtime:provider-preview-cc-switch',
  import: 'runtime:provider-import-cc-switch',
} as const;

export const WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS = {
  list: 'runtime:web-search-providers-list',
  save: 'runtime:web-search-provider-save',
  reorder: 'runtime:web-search-providers-reorder',
  test: 'runtime:web-search-provider-test',
} as const;

export const DATA_MANAGEMENT_IPC_CHANNELS = {
  storageStats: 'runtime:data-storage-stats',
  export: 'desktop:data-export',
  import: 'desktop:data-import',
  backup: 'runtime:data-backup',
  compactStorage: 'runtime:data-compact-storage',
  cleanConversations: 'runtime:data-clean-conversations',
  cleanEmptyAttachmentDirectories: 'runtime:data-clean-empty-attachment-directories',
  openDirectory: 'desktop:data-open-directory',
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
