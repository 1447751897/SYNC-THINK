// Stable error codes returned over the local protocol (dev principles §5).
// Strings are the wire contract; never renumber or reuse. Add new codes at end.
export const ErrorCode = {
  PROTOCOL_HANDSHAKE_FAILED: 'protocol.handshake_failed',
  PROTOCOL_VERSION_MISMATCH: 'protocol.version_mismatch',
  PROTOCOL_AUTH_REJECTED: 'protocol.auth_rejected',
  PROTOCOL_FRAME_MALFORMED: 'protocol.frame_malformed',
  PROTOCOL_UNEXPECTED_REQUEST: 'protocol.unexpected_request',
  RUN_NOT_FOUND: 'run.not_found',
  RUN_INVALID_STATE: 'run.invalid_state',
  STEP_NOT_FOUND: 'step.not_found',
  WORKSPACE_NOT_FOUND: 'workspace.not_found',
  TASK_NOT_FOUND: 'task.not_found',
  TASK_VERSION_MISMATCH: 'task.version_mismatch',
  MODEL_NOT_CONFIGURED: 'model.not_configured',
  MODEL_OVERRIDE_OUTSIDE_RUN: 'model.override_outside_run',
  CREDENTIAL_PIN_VIOLATION: 'credential.pin_violation',
  CREDENTIAL_GROUP_EMPTY: 'credential.group_empty',
  PROVIDER_CALL_FAILED: 'provider.call_failed',
  PROVIDER_AUTH_FAILED: 'provider.auth_failed',
  PROVIDER_TIMEOUT: 'provider.timeout',
  PROVIDER_RATE_LIMITED: 'provider.rate_limited',
  PROVIDER_PROTOCOL_INCOMPATIBLE: 'provider.protocol_incompatible',
  APPROVAL_REQUIRED: 'approval.required',
  APPROVAL_DENIED: 'approval.denied',
  HUMAN_ONLY_ACTION: 'approval.human_only',
  MIGRATION_FAILED: 'storage.migration_failed',
  DB_BACKUP_FAILED: 'storage.db_backup_failed',
  STORAGE_WRITE_FAILED: 'storage.write_failed',
  PATH_TRAVERSAL: 'security.path_traversal',
  UNAUTHORIZED_TOOL: 'security.unauthorized_tool',
  SECRET_SCRUB_FAILED: 'security.secret_scrub_failed',
  WORKER_CRASHED: 'worker.crashed',
  WORKER_TIMEOUT: 'worker.timeout',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface AppError {
  code: ErrorCode;
  /** User-actionable message (never carries secrets). */
  message: string;
  detail?: unknown;
  /** Diagnostic reference id; raw evidence lives in secret-scrubbed diagnostic store. */
  diagnosticRefId?: string;
}

