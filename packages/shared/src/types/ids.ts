// Stable identifier brand types. Branded primitives prevent accidental
// cross-assignment between IDs that share an underlying string shape.

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type WorkspaceId = Brand<string, 'Workspace'>;
export type TaskId = Brand<string, 'Task'>;
export type ThreadId = Brand<string, 'Thread'>;
export type PlanId = Brand<string, 'Plan'>;
export type PlanRevisionId = Brand<string, 'PlanRevision'>;
export type RunId = Brand<string, 'Run'>;
export type StepId = Brand<string, 'Step'>;
export type ArtifactId = Brand<string, 'Artifact'>;
export type ArtifactVersionId = Brand<string, 'ArtifactVersion'>;
export type EventId = Brand<string, 'Event'>;
export type MessageId = Brand<string, 'Message'>;
export type MemoryChangeId = Brand<string, 'MemoryChange'>;
export type ProviderId = Brand<string, 'Provider'>;
export type CredentialGroupId = Brand<string, 'CredentialGroup'>;
export type CredentialRefId = Brand<string, 'CredentialRef'>;
export type ModelId = Brand<string, 'Model'>;
export type AgentId = Brand<string, 'Agent'>;
export type AgentVersionId = Brand<string, 'AgentVersion'>;
export type SkillId = Brand<string, 'Skill'>;
export type SkillVersionId = Brand<string, 'SkillVersion'>;
export type McpServerId = Brand<string, 'McpServer'>;
export type PolicyId = Brand<string, 'Policy'>;
export type WorkflowVersionId = Brand<string, 'WorkflowVersion'>;
export type AcceptanceGateId = Brand<string, 'AcceptanceGate'>;
export type ApprovalRequestId = Brand<string, 'ApprovalRequest'>;

// ULID (Crockford base32, 26 chars, time-ordered + collision-safe).
// Single point of ID generation so IDs remain sortable and stable across Run
// history. The randomness section must use Crockford base32 alphabet only:
//   0123456789ABCDEFGHJKMNPQRSTVWXYZ     (excludes I, L, O, U)
const ENCODE = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let _counter = 0;
let _lastTimeMs = 0;

function encodeTime(ms: number): string {
  let t = Math.floor(ms);
  let out = '';
  for (let i = 9; i >= 0; i--) {
    out = ENCODE[(t >> (i * 5)) & 0x1f] + out;
  }
  return out;
}

function encodeRandom(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += ENCODE[Math.floor(Math.random() * 32)];
  return out;
}

export function ulid(now: number = Date.now()): string {
  let t = now;
  if (t <= _lastTimeMs) {
    _counter++;
    if (_counter > 0xffffff) {
      // overflow within same millisecond — advance 1ms to keep monotonicity.
      t = _lastTimeMs + 1;
      _counter = 0;
    }
  } else {
    _counter = 0;
  }
  _lastTimeMs = t;
  // 10 chars of time + 16 chars of randomness = 26 char ULID.
  return encodeTime(t) + encodeRandom(16);
}

export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;
