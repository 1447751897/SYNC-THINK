import type {
  AgentVersionId,
  ArtifactVersionStatus,
  JsonValue,
  RunId,
  StepId,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

const MAX_RESULT_BYTES = 256 * 1024;
const ID_RE = /^\S{1,256}$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;

export interface ProductionArtifactOutput {
  artifactName: string;
  content: string;
  mimeType: string;
  status: ArtifactVersionStatus;
  metadata?: Record<string, JsonValue>;
}

export interface ProductionExecutionResult {
  outputVersions: ProductionArtifactOutput[];
}

export interface ProductionExecutionFence {
  runId: RunId;
  stepId: StepId;
  agentVersionId: AgentVersionId;
  ownerId: string;
  executionAttempt: number;
}

export interface ProviderExecutionReservation extends ProductionExecutionFence {
  idempotencyKey: string;
  executionOwnerId: string;
  state: 'started' | 'released' | 'completed';
  result?: ProductionExecutionResult;
  checkpoint?: JsonValue;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface McpActionExecutionIntent extends ProductionExecutionFence {
  executionOwnerId: string;
  actionDigest: string;
  state: 'intent' | 'started' | 'completed';
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface ProviderRow {
  idempotency_key: string;
  run_id: string;
  step_id: string;
  agent_version_id: string;
  execution_owner_id: string;
  execution_attempt: number;
  state: string;
  result_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface McpRow {
  run_id: string;
  step_id: string;
  agent_version_id: string;
  execution_owner_id: string;
  execution_attempt: number;
  action_digest: string;
  state: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export class SqliteProductionExecutionStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  getCompletedProviderExecution(
    input: ProductionExecutionFence & { idempotencyKey: string },
  ): ProviderExecutionReservation | undefined {
    const normalized = normalizeProviderInput(input);
    const existing = this.getProviderExecution(normalized.idempotencyKey);
    if (!existing) return undefined;
    assertProviderScope(existing, normalized);
    return existing.state === 'completed' ? existing : undefined;
  }

  reserveProviderExecution(
    input: ProductionExecutionFence & { idempotencyKey: string; now?: string },
  ): ProviderExecutionReservation & { created: boolean } {
    const normalized = normalizeProviderInput(input);
    const requestedNow = input.now;
    return this.raw
      .transaction(() => {
        const now = normalizeOperationNow(requestedNow, 'provider.execution_fence_mismatch');
        const existing = this.getProviderExecution(normalized.idempotencyKey);
        if (existing) {
          assertProviderScope(existing, normalized);
          if (existing.state === 'released') {
            this.assertCurrentFence(normalized, now, normalized.idempotencyKey);
            const reclaimed = this.raw
              .prepare(
                `UPDATE provider_execution_reservation
             SET state = 'started', execution_owner_id = ?, execution_attempt = ?, updated_at = ?
             WHERE idempotency_key = ? AND state = 'released'`,
              )
              .run(normalized.ownerId, normalized.executionAttempt, now, normalized.idempotencyKey);
            if (reclaimed.changes !== 1) throw new Error('provider.execution_fence_mismatch');
            return {
              ...this.getRequiredProviderExecution(normalized.idempotencyKey),
              created: true,
            };
          }
          return { ...existing, created: false };
        }
        this.assertCurrentFence(normalized, now, normalized.idempotencyKey);
        this.raw
          .prepare(
            `INSERT INTO provider_execution_reservation (
           idempotency_key, run_id, step_id, agent_version_id,
           execution_owner_id, execution_attempt, state, result_json,
           created_at, updated_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'started', NULL, ?, ?, NULL)`,
          )
          .run(
            normalized.idempotencyKey,
            normalized.runId,
            normalized.stepId,
            normalized.agentVersionId,
            normalized.ownerId,
            normalized.executionAttempt,
            now,
            now,
          );
        return { ...this.getRequiredProviderExecution(normalized.idempotencyKey), created: true };
      })
      .immediate();
  }

  releaseProviderExecution(
    input: ProductionExecutionFence & { idempotencyKey: string; now?: string },
  ): ProviderExecutionReservation {
    const normalized = normalizeProviderInput(input);
    const requestedNow = input.now;
    return this.raw
      .transaction(() => {
        const now = normalizeOperationNow(requestedNow, 'provider.execution_fence_mismatch');
        const existing = this.getRequiredProviderExecution(normalized.idempotencyKey);
        assertProviderScope(existing, normalized);
        if (existing.state === 'released') return existing;
        if (existing.state === 'completed') throw new Error('provider.execution_already_completed');
        if (
          existing.executionOwnerId !== normalized.ownerId ||
          existing.executionAttempt !== normalized.executionAttempt
        ) {
          throw new Error('provider.execution_fence_mismatch');
        }
        const update = this.raw
          .prepare(
            `UPDATE provider_execution_reservation
         SET state = 'released', updated_at = ?
         WHERE idempotency_key = ? AND state = 'started'
           AND execution_owner_id = ? AND execution_attempt = ?`,
          )
          .run(now, normalized.idempotencyKey, normalized.ownerId, normalized.executionAttempt);
        if (update.changes !== 1) throw new Error('provider.execution_fence_mismatch');
        return this.getRequiredProviderExecution(normalized.idempotencyKey);
      })
      .immediate();
  }

  checkpointProviderExecution(
    input: ProductionExecutionFence & {
      idempotencyKey: string;
      checkpoint: JsonValue;
      now?: string;
    },
  ): ProviderExecutionReservation {
    const normalized = normalizeProviderInput(input);
    if (!isJsonValue(input.checkpoint)) throw new Error('provider.execution_checkpoint_invalid');
    const checkpointJson = JSON.stringify({
      kind: 'provider-checkpoint-v1',
      value: input.checkpoint,
    });
    if (Buffer.byteLength(checkpointJson, 'utf8') > MAX_RESULT_BYTES) {
      throw new Error('provider.execution_checkpoint_too_large');
    }
    const requestedNow = input.now;
    return this.raw
      .transaction(() => {
        const now = normalizeOperationNow(requestedNow, 'provider.execution_fence_mismatch');
        const existing = this.getRequiredProviderExecution(normalized.idempotencyKey);
        assertProviderScope(existing, normalized);
        if (
          existing.state !== 'started' ||
          existing.executionOwnerId !== normalized.ownerId ||
          existing.executionAttempt !== normalized.executionAttempt
        ) {
          throw new Error('provider.execution_fence_mismatch');
        }
        this.assertCurrentFence(normalized, now, normalized.idempotencyKey);
        this.raw
          .prepare(
            `INSERT INTO provider_execution_checkpoint (
             idempotency_key, checkpoint_json, updated_at
           ) VALUES (?, ?, ?)
           ON CONFLICT(idempotency_key) DO UPDATE SET
             checkpoint_json = excluded.checkpoint_json,
             updated_at = excluded.updated_at`,
          )
          .run(normalized.idempotencyKey, checkpointJson, now);
        return this.getRequiredProviderExecution(normalized.idempotencyKey);
      })
      .immediate();
  }

  completeProviderExecution(
    input: ProductionExecutionFence & {
      idempotencyKey: string;
      result: ProductionExecutionResult;
      now?: string;
    },
  ): ProviderExecutionReservation {
    const normalized = normalizeProviderInput(input);
    const result = normalizeResult(input.result);
    const resultJson = JSON.stringify(result);
    if (Buffer.byteLength(resultJson, 'utf8') > MAX_RESULT_BYTES) {
      throw new Error('provider.execution_result_too_large');
    }
    const requestedNow = input.now;
    return this.raw
      .transaction(() => {
        const now = normalizeOperationNow(requestedNow, 'provider.execution_fence_mismatch');
        const existing = this.getRequiredProviderExecution(normalized.idempotencyKey);
        assertProviderScope(existing, normalized);
        if (existing.state === 'completed') {
          if (JSON.stringify(existing.result) !== resultJson) {
            throw new Error('provider.execution_result_mismatch');
          }
          return existing;
        }
        if (
          existing.executionOwnerId !== normalized.ownerId ||
          existing.executionAttempt !== normalized.executionAttempt
        ) {
          throw new Error('provider.execution_fence_mismatch');
        }
        this.assertCurrentFence(normalized, now, normalized.idempotencyKey);
        const update = this.raw
          .prepare(
            `UPDATE provider_execution_reservation
         SET state = 'completed', result_json = ?, updated_at = ?, completed_at = ?
         WHERE idempotency_key = ? AND state = 'started'
           AND execution_owner_id = ? AND execution_attempt = ?`,
          )
          .run(
            resultJson,
            now,
            now,
            normalized.idempotencyKey,
            normalized.ownerId,
            normalized.executionAttempt,
          );
        if (update.changes !== 1) throw new Error('provider.execution_fence_mismatch');
        return this.getRequiredProviderExecution(normalized.idempotencyKey);
      })
      .immediate();
  }

  getProviderExecution(idempotencyKey: string): ProviderExecutionReservation | undefined {
    const row = this.raw
      .prepare(
        `SELECT idempotency_key, run_id, step_id, agent_version_id,
         execution_owner_id, execution_attempt, state, result_json,
         created_at, updated_at, completed_at
       FROM provider_execution_reservation WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey) as ProviderRow | undefined;
    if (!row) return undefined;
    const reservation = mapProviderRow(row);
    if (reservation.state === 'completed') return reservation;
    const checkpointRow = this.raw
      .prepare(
        `SELECT checkpoint_json AS checkpointJson
         FROM provider_execution_checkpoint WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey) as { checkpointJson: string } | undefined;
    return checkpointRow
      ? { ...reservation, checkpoint: parseCheckpoint(checkpointRow.checkpointJson) }
      : reservation;
  }

  createMcpActionIntent(
    input: ProductionExecutionFence & { actionDigest: string; now?: string },
  ): McpActionExecutionIntent {
    const normalized = normalizeMcpInput(input);
    const requestedNow = input.now;
    return this.raw
      .transaction(() => {
        const now = normalizeOperationNow(requestedNow, 'mcp.action_fence_mismatch');
        const existing = this.getMcpActionIntent(
          normalized.runId,
          normalized.stepId,
          normalized.actionDigest,
        );
        if (existing) {
          assertMcpScope(existing, normalized);
          return existing;
        }
        this.assertCurrentFence(normalized, now);
        this.raw
          .prepare(
            `INSERT INTO mcp_action_execution_intent (
           run_id, step_id, agent_version_id, execution_owner_id,
           execution_attempt, action_digest, state, created_at, updated_at,
           started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'intent', ?, ?, NULL, NULL)`,
          )
          .run(
            normalized.runId,
            normalized.stepId,
            normalized.agentVersionId,
            normalized.ownerId,
            normalized.executionAttempt,
            normalized.actionDigest,
            now,
            now,
          );
        return this.getRequiredMcpAction(normalized);
      })
      .immediate();
  }

  startMcpAction(
    input: ProductionExecutionFence & { actionDigest: string; now?: string },
  ): McpActionExecutionIntent & { startedNow: boolean } {
    const normalized = normalizeMcpInput(input);
    const requestedNow = input.now;
    return this.raw
      .transaction(() => {
        const now = normalizeOperationNow(requestedNow, 'mcp.action_fence_mismatch');
        const existing = this.getRequiredMcpAction(normalized);
        assertMcpScope(existing, normalized);
        if (existing.state !== 'intent') return { ...existing, startedNow: false };
        this.assertCurrentFence(normalized, now);
        const update = this.raw
          .prepare(
            `UPDATE mcp_action_execution_intent
         SET state = 'started', updated_at = ?, started_at = ?
         WHERE run_id = ? AND step_id = ? AND action_digest = ? AND state = 'intent'`,
          )
          .run(now, now, normalized.runId, normalized.stepId, normalized.actionDigest);
        if (update.changes !== 1) throw new Error('mcp.action_fence_mismatch');
        return { ...this.getRequiredMcpAction(normalized), startedNow: true };
      })
      .immediate();
  }

  completeMcpAction(
    input: ProductionExecutionFence & { actionDigest: string; now?: string },
  ): McpActionExecutionIntent {
    const normalized = normalizeMcpInput(input);
    const requestedNow = input.now;
    return this.raw
      .transaction(() => {
        const now = normalizeOperationNow(requestedNow, 'mcp.action_fence_mismatch');
        const existing = this.getRequiredMcpAction(normalized);
        assertMcpScope(existing, normalized);
        if (existing.state === 'completed') return existing;
        if (existing.state !== 'started') throw new Error('mcp.action_not_started');
        this.assertCurrentFence(normalized, now);
        const update = this.raw
          .prepare(
            `UPDATE mcp_action_execution_intent
         SET state = 'completed', updated_at = ?, completed_at = ?
         WHERE run_id = ? AND step_id = ? AND action_digest = ? AND state = 'started'`,
          )
          .run(now, now, normalized.runId, normalized.stepId, normalized.actionDigest);
        if (update.changes !== 1) throw new Error('mcp.action_fence_mismatch');
        return this.getRequiredMcpAction(normalized);
      })
      .immediate();
  }

  getMcpActionIntent(
    runId: RunId,
    stepId: StepId,
    actionDigest: string,
  ): McpActionExecutionIntent | undefined {
    const row = this.raw
      .prepare(
        `SELECT run_id, step_id, agent_version_id, execution_owner_id,
         execution_attempt, action_digest, state, created_at, updated_at,
         started_at, completed_at
       FROM mcp_action_execution_intent
       WHERE run_id = ? AND step_id = ? AND action_digest = ?`,
      )
      .get(runId, stepId, actionDigest) as McpRow | undefined;
    return row ? mapMcpRow(row) : undefined;
  }

  private getRequiredProviderExecution(idempotencyKey: string): ProviderExecutionReservation {
    const result = this.getProviderExecution(idempotencyKey);
    if (!result) throw new Error('provider.execution_reservation_not_found');
    return result;
  }

  private getRequiredMcpAction(
    input: ProductionExecutionFence & { actionDigest: string },
  ): McpActionExecutionIntent {
    const result = this.getMcpActionIntent(input.runId, input.stepId, input.actionDigest);
    if (!result) throw new Error('mcp.action_intent_not_found');
    return result;
  }

  private assertCurrentFence(
    input: ProductionExecutionFence,
    now: string,
    idempotencyKey?: string,
  ): void {
    const row = this.raw
      .prepare(
        `SELECT state, agent_version_id, execution_owner_id, execution_attempt,
         idempotency_key, lease_expires_at
       FROM step WHERE run_id = ? AND id = ?`,
      )
      .get(input.runId, input.stepId) as
      | {
          state: string;
          agent_version_id: string;
          execution_owner_id: string | null;
          execution_attempt: number;
          idempotency_key: string | null;
          lease_expires_at: string | null;
        }
      | undefined;
    if (
      !row ||
      row.state !== 'running' ||
      row.agent_version_id !== input.agentVersionId ||
      row.execution_owner_id !== input.ownerId ||
      row.execution_attempt !== input.executionAttempt ||
      (idempotencyKey !== undefined && row.idempotency_key !== idempotencyKey) ||
      !isCanonicalIsoInstant(row.lease_expires_at) ||
      row.lease_expires_at <= now
    ) {
      throw new Error(
        idempotencyKey ? 'provider.execution_fence_mismatch' : 'mcp.action_fence_mismatch',
      );
    }
  }
}

function normalizeOperationNow(value: string | undefined, fenceError: string): string {
  const now = value ?? new Date().toISOString();
  if (!isCanonicalIsoInstant(now)) throw new Error(fenceError);
  return now;
}

function isCanonicalIsoInstant(value: unknown): value is string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(value ?? ''))) {
    return false;
  }
  const timestamp = Date.parse(value as string);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function normalizeFence<T extends ProductionExecutionFence>(input: T): T {
  if (
    !ID_RE.test(String(input.runId)) ||
    !ID_RE.test(String(input.stepId)) ||
    !ID_RE.test(String(input.agentVersionId)) ||
    !ID_RE.test(input.ownerId) ||
    !Number.isSafeInteger(input.executionAttempt) ||
    input.executionAttempt < 1
  ) {
    throw new Error('production.execution_input_invalid');
  }
  return input;
}

function normalizeProviderInput<T extends ProductionExecutionFence & { idempotencyKey: string }>(
  input: T,
): T {
  normalizeFence(input);
  if (!ID_RE.test(input.idempotencyKey)) throw new Error('provider.idempotency_key_invalid');
  return input;
}

function normalizeMcpInput<T extends ProductionExecutionFence & { actionDigest: string }>(
  input: T,
): T {
  normalizeFence(input);
  if (!DIGEST_RE.test(input.actionDigest)) throw new Error('mcp.action_digest_invalid');
  return input;
}

function normalizeResult(value: ProductionExecutionResult): ProductionExecutionResult {
  if (!value || !Array.isArray(value.outputVersions) || value.outputVersions.length > 16) {
    throw new Error('provider.execution_result_invalid');
  }
  return {
    outputVersions: value.outputVersions.map((output) => {
      if (
        !output ||
        typeof output.artifactName !== 'string' ||
        !output.artifactName.trim() ||
        output.artifactName.length > 512 ||
        typeof output.content !== 'string' ||
        typeof output.mimeType !== 'string' ||
        !output.mimeType.includes('/') ||
        !['candidate', 'selected', 'merged'].includes(output.status)
      ) {
        throw new Error('provider.execution_result_invalid');
      }
      return {
        artifactName: output.artifactName,
        content: output.content,
        mimeType: output.mimeType,
        status: output.status,
        ...(output.metadata === undefined ? {} : { metadata: output.metadata }),
      };
    }),
  };
}

function mapProviderRow(row: ProviderRow): ProviderExecutionReservation {
  if (row.state !== 'started' && row.state !== 'released' && row.state !== 'completed') {
    throw new Error('provider.execution_record_invalid');
  }
  const result = row.result_json === null ? undefined : parseResult(row.result_json);
  if ((row.state === 'completed') !== Boolean(result && row.completed_at)) {
    throw new Error('provider.execution_record_invalid');
  }
  return {
    idempotencyKey: row.idempotency_key,
    runId: row.run_id as RunId,
    stepId: row.step_id as StepId,
    agentVersionId: row.agent_version_id as AgentVersionId,
    ownerId: row.execution_owner_id,
    executionOwnerId: row.execution_owner_id,
    executionAttempt: row.execution_attempt,
    state: row.state,
    ...(result ? { result } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function parseCheckpoint(raw: string): JsonValue {
  if (Buffer.byteLength(raw, 'utf8') > MAX_RESULT_BYTES) {
    throw new Error('provider.execution_record_invalid');
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 2 ||
      (parsed as { kind?: unknown }).kind !== 'provider-checkpoint-v1' ||
      !Object.prototype.hasOwnProperty.call(parsed, 'value') ||
      !isJsonValue((parsed as { value?: unknown }).value)
    ) {
      throw new Error('invalid');
    }
    return (parsed as { value: JsonValue }).value;
  } catch {
    throw new Error('provider.execution_record_invalid');
  }
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  if (typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every((entry) =>
    isJsonValue(entry, depth + 1),
  );
}

function parseResult(raw: string): ProductionExecutionResult {
  if (Buffer.byteLength(raw, 'utf8') > MAX_RESULT_BYTES)
    throw new Error('provider.execution_record_invalid');
  try {
    return normalizeResult(JSON.parse(raw) as ProductionExecutionResult);
  } catch {
    throw new Error('provider.execution_record_invalid');
  }
}

function mapMcpRow(row: McpRow): McpActionExecutionIntent {
  if (row.state !== 'intent' && row.state !== 'started' && row.state !== 'completed') {
    throw new Error('mcp.action_record_invalid');
  }
  return {
    runId: row.run_id as RunId,
    stepId: row.step_id as StepId,
    agentVersionId: row.agent_version_id as AgentVersionId,
    ownerId: row.execution_owner_id,
    executionOwnerId: row.execution_owner_id,
    executionAttempt: row.execution_attempt,
    actionDigest: row.action_digest,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function assertProviderScope(
  existing: ProviderExecutionReservation,
  input: ProductionExecutionFence & { idempotencyKey: string },
): void {
  if (
    existing.runId !== input.runId ||
    existing.stepId !== input.stepId ||
    existing.agentVersionId !== input.agentVersionId ||
    existing.idempotencyKey !== input.idempotencyKey
  ) {
    throw new Error('provider.execution_scope_mismatch');
  }
}

function assertMcpScope(
  existing: McpActionExecutionIntent,
  input: ProductionExecutionFence & { actionDigest: string },
): void {
  if (
    existing.runId !== input.runId ||
    existing.stepId !== input.stepId ||
    existing.agentVersionId !== input.agentVersionId ||
    existing.executionOwnerId !== input.ownerId ||
    existing.executionAttempt !== input.executionAttempt ||
    existing.actionDigest !== input.actionDigest
  ) {
    throw new Error('mcp.action_scope_mismatch');
  }
}
