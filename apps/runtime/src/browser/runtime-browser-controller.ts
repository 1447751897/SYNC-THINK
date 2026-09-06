import { createHash } from 'node:crypto';
import type {
  BrowserCommandRecord,
  BrowserGrantScope,
  BrowserOriginGrantRecord,
  SqliteBrowserStore,
} from '@sync-think/storage';
import type {
  BrowserAction,
  BrowserHostLike,
  BrowserLeaseInfo,
  BrowserWorker,
  BrowserWorkerInput,
  WorkerEvent,
  WorkerToken,
} from '@sync-think/workers';
import {
  BROWSER_COMMAND_RESULT_MAX_CHARS,
  BROWSER_COMMAND_TIMEOUT_MS,
  validateChatBrowserCommand,
  validateChatBrowserOpen,
} from '../chat-tools.js';
import {
  RuntimeBrowserProfileGate,
  type BrowserProfileOperationGate,
} from './runtime-browser-profile-gate.js';

type BrowserFailureClass = 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown';

export type BrowserHandoffReason =
  'login' | 'captcha' | 'payment' | 'device-confirmation' | 'manual';
export type BrowserHandoffCancelDisposition = 'keep-open' | 'close-page';

export interface RuntimeBrowserHandoffRequest {
  workspaceId: string;
  runId: string;
  ownerId: string;
  idempotencyKey: string;
  reason: BrowserHandoffReason;
  requestedOutcome: string;
  onCancel: BrowserHandoffCancelDisposition;
  agentVersionId?: string;
  stepId?: string;
}

export interface RuntimeBrowserHandoffSummary {
  handoffId: string;
  revision: 1;
  workspaceId: string;
  runId: string;
  stepId?: string;
  agentVersionId?: string;
  siteOrigin: string;
  reason: BrowserHandoffReason;
  requestedOutcome: string;
  onCancel: BrowserHandoffCancelDisposition;
  status: 'waiting_user';
  createdAt: string;
  updatedAt: string;
  canContinue: true;
  canCancel: true;
}

export type RuntimeBrowserHandoffRequestResult =
  | { status: 'waiting_user'; handoff: RuntimeBrowserHandoffSummary }
  | { status: 'continued'; handoffId: string; replayed: boolean; result: Record<string, unknown> }
  | { status: 'cancelled'; handoffId: string; replayed: true };

export interface RuntimeBrowserHandoffContext {
  handoffId: string;
  revision: 1;
  workspaceId: string;
  runId: string;
  profileId: string;
  siteOrigin: string;
  reason: BrowserHandoffReason;
  stepId?: string;
  agentVersionId?: string;
  state: BrowserCommandRecord['state'];
  errorCode?: string;
}

export class RuntimeBrowserHandoffError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeBrowserHandoffError';
  }
}

export interface RuntimeBrowserIntent {
  commandId: string;
  idempotencyKey: string;
  toolName: string;
  profileId: string;
  ownerId: string;
  agentVersionId?: string;
  stepId?: string;
  targetOrigin: string;
  permissionAction: string;
  action: BrowserAction;
  allowedOrigins: string[];
  auditArgs: Record<string, unknown>;
}

export interface RuntimeBrowserControllerOptions {
  worker: BrowserWorker;
  store: SqliteBrowserStore;
  profileId?: string;
  fallbackWorkingDir: string;
  leaseHost?: Pick<BrowserHostLike, 'inspectLease' | 'recoverLease' | 'releaseLease'>;
  profileGate?: BrowserProfileOperationGate;
}

export interface RuntimeBrowserPermissionInput {
  toolName: string;
  argumentsJson: string;
  workspaceId: string;
  runId: string;
  ownerId: string;
  idempotencyKey: string;
  agentVersionId?: string;
  stepId?: string;
  /** Exact frozen AgentVersion browser permission snapshot. Omitted for conversation Runs. */
  allowedOrigins?: readonly string[];
  workspaceRoot?: string;
}

export type RuntimeBrowserPermissionDecision =
  | {
      decision: 'allow' | 'approval-required';
      targetOrigin: string;
      permissionAction: string;
      matches: BrowserOriginGrantRecord[];
    }
  | {
      decision: 'deny';
      code: string;
      error: string;
      failureClass: BrowserFailureClass;
    };

export interface RuntimeBrowserExecuteInput extends RuntimeBrowserPermissionInput {
  capabilityToken: string;
  signal: AbortSignal;
  /** Optional per-command Worker override (the desktop embedded WebView path). */
  worker?: BrowserWorker;
  approval?: { approvalId: string };
  beforeStart?: () => boolean;
  beforeExecute?(intent: RuntimeBrowserIntent): void | Promise<void>;
  onWorkerEvent?(event: WorkerEvent): void | Promise<void>;
}

interface PreparedBrowserAction {
  action: BrowserAction;
  auditArgs: Record<string, unknown>;
  openedOrigin?: string;
}

export class RuntimeBrowserController {
  private readonly worker: BrowserWorker;
  private readonly store: SqliteBrowserStore;
  private readonly profileId: string;
  private readonly fallbackWorkingDir: string;
  private readonly leaseHost?: Pick<
    BrowserHostLike,
    'inspectLease' | 'recoverLease' | 'releaseLease'
  >;
  private readonly profileGate: BrowserProfileOperationGate;

  constructor(options: RuntimeBrowserControllerOptions) {
    this.worker = options.worker;
    this.store = options.store;
    this.profileId = options.profileId?.trim() || 'default';
    this.fallbackWorkingDir = options.fallbackWorkingDir;
    this.leaseHost = options.leaseHost;
    this.profileGate = options.profileGate ?? new RuntimeBrowserProfileGate();
    // A Runtime crash may leave an external side effect with an unknown result.
    // Never retry it automatically; require inspection instead.
    this.store.recoverUnknownInFlight();
  }

  evaluatePermission(input: RuntimeBrowserPermissionInput): RuntimeBrowserPermissionDecision {
    const resolved = this.resolveIntent(input);
    if (!resolved.ok) {
      return {
        decision: 'deny',
        code: resolved.code,
        error: resolved.error,
        failureClass: resolved.failureClass,
      };
    }
    const decision = this.store.resolveOriginDecision({
      scopes: grantScopes(input),
      origin: resolved.targetOrigin,
      action: resolved.permissionAction,
    });
    if (decision.decision === 'deny') {
      return {
        decision: 'deny',
        code: 'browser.origin-denied',
        error: 'Browser permission was denied for this origin and action.',
        failureClass: 'permission',
      };
    }
    return {
      decision: decision.decision === 'allow' ? 'allow' : 'approval-required',
      targetOrigin: resolved.targetOrigin,
      permissionAction: resolved.permissionAction,
      matches: decision.matches,
    };
  }

  recordPermissionDecision(
    input: RuntimeBrowserPermissionInput,
    decision: 'allow' | 'deny',
    approvalId: string,
  ): RuntimeBrowserPermissionDecision {
    const resolved = this.resolveIntent(input);
    if (!resolved.ok) {
      return {
        decision: 'deny',
        code: resolved.code,
        error: resolved.error,
        failureClass: resolved.failureClass,
      };
    }
    this.store.upsertOriginGrant({
      ...decisionGrantScope(input),
      origin: resolved.targetOrigin,
      action: resolved.permissionAction,
      decision,
      approvalId,
    });
    return this.evaluatePermission(input);
  }

  async execute(input: RuntimeBrowserExecuteInput): Promise<string> {
    const resolved = this.resolveIntent(input);
    if (!resolved.ok) {
      return failureJson(resolved.code, resolved.error, resolved.failureClass);
    }

    let command;
    try {
      command = await this.profileGate.runExclusive(this.profileId, () =>
        this.store.reserveCommand({
          idempotencyKey: input.idempotencyKey,
          workspaceId: input.workspaceId,
          runId: input.runId,
          ownerId: input.ownerId,
          profileId: this.profileId,
          toolName: input.toolName,
          action: resolved.permissionAction,
          targetOrigin: resolved.targetOrigin,
          sanitizedArgs: resolved.prepared.auditArgs,
        }),
      );
    } catch (error) {
      return failureJson(
        'browser.command-persist-failed',
        error instanceof Error && error.message === 'browser.command_idempotency_mismatch'
          ? 'Browser command idempotency key was reused with different input.'
          : 'Browser command could not be persisted; no browser action was started.',
        'unknown',
      );
    }

    if (!command.created) {
      if (command.state === 'completed') {
        return JSON.stringify({
          ...(asObject(command.result?.output) ?? { ok: true }),
          replayed: true,
          commandId: command.id,
        });
      }
      if (command.state === 'failed') {
        return failureJson(
          command.errorCode ?? 'browser.command-failed',
          'The persisted Browser command already failed and was not retried.',
          asFailureClass(command.failureClass),
        );
      }
      if (
        command.state === 'waiting_user' &&
        command.errorCode === 'browser.command-inspection-required'
      ) {
        return failureJson(
          'browser.command-inspection-required',
          'A prior Browser command may have executed before Runtime stopped. Inspect it before continuing.',
          'permission',
        );
      }
      if (command.state === 'running') {
        return failureJson(
          'browser.command-in-flight',
          'This Browser command is already running.',
          'acceptance',
        );
      }
    }

    let permission = this.store.resolveOriginDecision({
      scopes: grantScopes(input),
      origin: resolved.targetOrigin,
      action: resolved.permissionAction,
    });
    if (permission.decision === 'deny') {
      this.store.failCommand(command.id, {
        code: 'browser.origin-denied',
        failureClass: 'permission',
      });
      return failureJson(
        'browser.origin-denied',
        'Browser permission was denied for this origin and action.',
        'permission',
      );
    }
    if (permission.decision !== 'allow' && input.approval) {
      this.store.upsertOriginGrant({
        ...decisionGrantScope(input),
        origin: resolved.targetOrigin,
        action: resolved.permissionAction,
        decision: 'allow',
        approvalId: input.approval.approvalId,
      });
      permission = this.store.resolveOriginDecision({
        scopes: grantScopes(input),
        origin: resolved.targetOrigin,
        action: resolved.permissionAction,
      });
    }
    if (permission.decision !== 'allow') {
      this.store.markWaitingUser(command.id, 'browser.origin-grant-required');
      return failureJson(
        'browser.origin-grant-required',
        'Human approval is required for this Browser origin and action.',
        'permission',
      );
    }

    if (input.toolName === 'browser_screenshot' && !input.workspaceRoot) {
      this.store.failCommand(command.id, {
        code: 'browser.screenshot-root-required',
        failureClass: 'permission',
      });
      return failureJson(
        'browser.screenshot-root-required',
        'A bound project folder is required for browser screenshots.',
        'permission',
      );
    }

    try {
      this.store.markApproved(command.id);
      this.store.markRunning(command.id);
    } catch {
      return failureJson(
        'browser.command-transition-failed',
        'Browser command state could not be advanced; no browser action was started.',
        'unknown',
      );
    }

    const intent: RuntimeBrowserIntent = {
      commandId: command.id,
      idempotencyKey: input.idempotencyKey,
      toolName: input.toolName,
      profileId: this.profileId,
      ownerId: input.ownerId,
      ...(input.agentVersionId ? { agentVersionId: input.agentVersionId } : {}),
      ...(input.stepId ? { stepId: input.stepId } : {}),
      targetOrigin: resolved.targetOrigin,
      permissionAction: resolved.permissionAction,
      action: resolved.prepared.action,
      allowedOrigins: [resolved.targetOrigin],
      auditArgs: resolved.prepared.auditArgs,
    };
    try {
      await input.beforeExecute?.(intent);
    } catch {
      this.store.failCommand(command.id, {
        code: 'browser.intent-persist-failed',
        failureClass: 'unknown',
      });
      return failureJson(
        'browser.intent-persist-failed',
        'Browser intent could not be persisted; no browser action was started.',
        'unknown',
      );
    }

    const workingDir = input.workspaceRoot ?? this.fallbackWorkingDir;
    const workerInput: BrowserWorkerInput = {
      workingDir,
      profileId: this.profileId,
      ownerId: input.ownerId,
      allowedSites: [resolved.targetOrigin],
      action: resolved.prepared.action,
    };
    const token: WorkerToken = {
      token: input.capabilityToken,
      allowedRoot: workingDir,
      timeoutMs: BROWSER_COMMAND_TIMEOUT_MS,
      maxOutputBytes: BROWSER_COMMAND_RESULT_MAX_CHARS,
      signal: input.signal,
      beforeStart: input.beforeStart,
    };

    try {
      for await (const event of (input.worker ?? this.worker).exec(workerInput, token)) {
        await input.onWorkerEvent?.(event);
        if (event.type === 'failed') {
          this.store.failCommand(command.id, {
            code: event.error.code,
            failureClass: event.failureClass,
          });
          return failureJson(event.error.code, event.error.message, event.failureClass);
        }
        if (event.type === 'completed') {
          const output = asObject(event.output) ?? { ok: true };
          const auditIdentity = {
            commandId: command.id,
            ownerId: input.ownerId,
            targetOrigin: resolved.targetOrigin,
            ...(input.agentVersionId ? { agentVersionId: input.agentVersionId } : {}),
            ...(input.stepId ? { stepId: input.stepId } : {}),
          };
          const enrichedOutput = { ...output, ...auditIdentity };
          const durableOutput = resultMetadata(enrichedOutput);
          this.store.completeCommand(command.id, durableOutput, leaseIdentity(output));
          return JSON.stringify(enrichedOutput);
        }
      }
      this.store.failCommand(command.id, {
        code: 'browser.worker-no-terminal-event',
        failureClass: 'crashed',
      });
      return failureJson(
        'browser.worker-no-terminal-event',
        'Browser Worker ended without a terminal event.',
        'crashed',
      );
    } catch (error) {
      const code = input.signal.aborted ? 'worker.aborted' : 'browser.worker-failed';
      const failureClass: BrowserFailureClass = input.signal.aborted ? 'acceptance' : 'unknown';
      this.store.failCommand(command.id, { code, failureClass });
      return failureJson(
        code,
        input.signal.aborted
          ? 'Browser action was cancelled.'
          : error instanceof Error
            ? error.message
            : 'Browser Worker failed.',
        failureClass,
      );
    }
  }

  async requestHandoff(
    input: RuntimeBrowserHandoffRequest,
  ): Promise<RuntimeBrowserHandoffRequestResult> {
    const normalized = normalizeHandoffRequest(input);
    const previous = this.store.getLastCompletedCommand({
      workspaceId: normalized.workspaceId,
      runId: normalized.runId,
      ownerId: normalized.ownerId,
      profileId: this.profileId,
    });
    if (!previous?.leaseId || !previous.pageId) {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-page-required',
        'A completed Browser command with an active Page lease is required before handoff.',
      );
    }
    const command = await this.profileGate.runExclusive(this.profileId, () =>
      this.store.reserveCommand({
        idempotencyKey: normalized.idempotencyKey,
        workspaceId: normalized.workspaceId,
        runId: normalized.runId,
        ownerId: normalized.ownerId,
        profileId: this.profileId,
        leaseId: previous.leaseId,
        pageId: previous.pageId,
        toolName: 'browser_handoff',
        action: 'handoff',
        targetOrigin: previous.targetOrigin,
        sanitizedArgs: {
          reason: normalized.reason,
          requestedOutcome: normalized.requestedOutcome,
          onCancel: normalized.onCancel,
          ...(normalized.agentVersionId ? { agentVersionId: normalized.agentVersionId } : {}),
          ...(normalized.stepId ? { stepId: normalized.stepId } : {}),
        },
      }),
    );

    if (command.state === 'completed') {
      return {
        status: 'continued',
        handoffId: command.id,
        replayed: true,
        result: asObject(command.result?.output) ?? { ok: true, status: 'continued' },
      };
    }
    if (command.state === 'failed') {
      if (command.errorCode === 'browser.handoff-cancelled') {
        return { status: 'cancelled', handoffId: command.id, replayed: true };
      }
      throw new RuntimeBrowserHandoffError(
        command.errorCode ?? 'browser.handoff-failed',
        'The persisted Browser handoff cannot be resumed.',
      );
    }
    if (command.state === 'approved') {
      await this.assertHandoffLease(command);
      this.store.markRunning(command.id);
      const result = handoffContinuedResult(command);
      this.store.completeCommand(command.id, result, {
        leaseId: command.leaseId!,
        pageId: command.pageId!,
      });
      return { status: 'continued', handoffId: command.id, replayed: false, result };
    }
    if (command.state === 'running') {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-in-flight',
        'The Browser handoff continuation is already being consumed.',
      );
    }

    await this.assertHandoffLease(command);
    const waiting = this.store.markHandoffWaiting(command.id, {
      leaseId: command.leaseId!,
      pageId: command.pageId!,
    });
    return { status: 'waiting_user', handoff: handoffSummary(waiting) };
  }

  listWaitingHandoffs(
    input: {
      workspaceId?: string;
      runId?: string;
    } = {},
  ): RuntimeBrowserHandoffSummary[] {
    return this.store.listWaitingHandoffs(input).map(handoffSummary);
  }

  /**
   * Cold-start recovery expires the whole Run before any continuation can be resumed.
   * Browser commands remain durable audit records, but must no longer keep their Profile busy.
   */
  expireRunCommands(runId: string, now?: string): number {
    return this.store.failActiveCommandsForRun(runId, 'browser.command-recovery-expired', now);
  }

  inspectHandoff(handoffId: string): RuntimeBrowserHandoffContext {
    const command = this.getHandoffCommand(handoffId);
    const args = handoffArgs(command);
    return {
      handoffId: command.id,
      revision: 1,
      workspaceId: command.workspaceId,
      runId: command.runId,
      profileId: command.profileId,
      siteOrigin: command.targetOrigin,
      reason: args.reason,
      ...(args.stepId ? { stepId: args.stepId } : {}),
      ...(args.agentVersionId ? { agentVersionId: args.agentVersionId } : {}),
      state: command.state,
      ...(command.errorCode ? { errorCode: command.errorCode } : {}),
    };
  }

  async continueHandoff(input: {
    handoffId: string;
    expectedRevision: number;
  }): Promise<{ status: 'continued'; handoffId: string; replayed: boolean }> {
    const command = this.getHandoffCommand(input.handoffId);
    assertHandoffRevision(input.expectedRevision);
    if (
      command.state === 'approved' ||
      command.state === 'running' ||
      command.state === 'completed'
    ) {
      return { status: 'continued', handoffId: command.id, replayed: true };
    }
    if (command.state !== 'waiting_user' || command.errorCode !== 'browser.handoff-required') {
      throw new RuntimeBrowserHandoffError(
        command.errorCode === 'browser.handoff-cancelled'
          ? 'browser.handoff-already-cancelled'
          : 'browser.handoff-not-waiting',
        'The Browser handoff is no longer waiting for Continue.',
      );
    }
    await this.assertHandoffLease(command);
    try {
      this.store.markApproved(command.id);
    } catch (error) {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-conflict',
        error instanceof Error ? error.message : 'Browser handoff state changed concurrently.',
      );
    }
    return { status: 'continued', handoffId: command.id, replayed: false };
  }

  async cancelHandoff(input: {
    handoffId: string;
    expectedRevision: number;
    leaseDisposition?: 'preserve' | 'release';
  }): Promise<{ status: 'cancelled'; handoffId: string; replayed: boolean }> {
    const command = this.getHandoffCommand(input.handoffId);
    assertHandoffRevision(input.expectedRevision);
    if (command.state === 'failed' && command.errorCode === 'browser.handoff-cancelled') {
      return { status: 'cancelled', handoffId: command.id, replayed: true };
    }
    if (command.state !== 'waiting_user' || command.errorCode !== 'browser.handoff-required') {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-not-waiting',
        'The Browser handoff is no longer waiting for Cancel.',
      );
    }
    const args = handoffArgs(command);
    const closePage =
      input.leaseDisposition === 'release' ||
      (input.leaseDisposition === undefined && args.onCancel === 'close-page');
    let releaseLease = false;
    if (command.leaseId) {
      try {
        await this.assertHandoffLease(command);
        releaseLease = closePage;
      } catch (error) {
        const code = browserErrorCode(error);
        if (code !== 'browser.lease-not-found' && code !== 'browser.session-not-found') throw error;
      }
    }
    try {
      this.store.failCommand(command.id, {
        code: 'browser.handoff-cancelled',
        failureClass: 'acceptance',
      });
    } catch (error) {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-conflict',
        error instanceof Error ? error.message : 'Browser handoff state changed concurrently.',
      );
    }
    if (releaseLease && command.leaseId) {
      await this.requireLeaseHost().releaseLease(command.leaseId, { closePage: true });
    }
    return { status: 'cancelled', handoffId: command.id, replayed: false };
  }

  private getHandoffCommand(id: string): BrowserCommandRecord {
    const command = this.store.getCommand(id);
    if (!command || command.toolName !== 'browser_handoff' || command.action !== 'handoff') {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-not-found',
        'Browser handoff was not found.',
      );
    }
    return command;
  }

  private async assertHandoffLease(command: BrowserCommandRecord): Promise<void> {
    if (!command.leaseId || !command.pageId) {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-checkpoint-invalid',
        'Browser handoff does not contain a complete Page lease checkpoint.',
      );
    }
    const leaseHost = this.requireLeaseHost();
    let lease: BrowserLeaseInfo;
    try {
      lease = await leaseHost.inspectLease(command.leaseId);
    } catch (error) {
      if (browserErrorCode(error) !== 'browser.lease-not-found' || !leaseHost.recoverLease) {
        throw error;
      }
      lease = await leaseHost.recoverLease({
        leaseId: command.leaseId,
        pageId: command.pageId,
        profileId: command.profileId,
        ownerId: command.ownerId,
      });
    }
    if (
      lease.leaseId !== command.leaseId ||
      lease.pageId !== command.pageId ||
      lease.profileId !== command.profileId ||
      lease.ownerId !== command.ownerId
    ) {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-ownership-mismatch',
        'Browser Page lease ownership no longer matches the persisted handoff.',
      );
    }
  }

  private requireLeaseHost(): Pick<
    BrowserHostLike,
    'inspectLease' | 'recoverLease' | 'releaseLease'
  > {
    if (!this.leaseHost) {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-host-unavailable',
        'Browser Host is unavailable for handoff lease validation.',
      );
    }
    return this.leaseHost;
  }

  private resolveIntent(input: RuntimeBrowserPermissionInput):
    | {
        ok: true;
        prepared: PreparedBrowserAction;
        targetOrigin: string;
        permissionAction: string;
      }
    | { ok: false; code: string; error: string; failureClass: BrowserFailureClass } {
    const prepared = prepareBrowserAction(input.toolName, input.argumentsJson);
    if (!prepared.ok) {
      return {
        ok: false,
        code: prepared.code,
        error: prepared.error,
        failureClass: 'acceptance',
      };
    }
    const targetOrigin =
      prepared.value.openedOrigin ??
      this.store.getLastCompletedOrigin({
        workspaceId: input.workspaceId,
        ownerId: input.ownerId,
        profileId: this.profileId,
      });
    if (!targetOrigin) {
      return {
        ok: false,
        code: 'browser.origin-grant-required',
        error: 'Open and approve an http(s) URL with browser_open before operating the Page.',
        failureClass: 'permission',
      };
    }
    if (input.allowedOrigins && !isOriginAllowedBySnapshot(targetOrigin, input.allowedOrigins)) {
      return {
        ok: false,
        code: 'browser.agent-origin-denied',
        error: 'The acting AgentVersion does not permit this Browser origin.',
        failureClass: 'permission',
      };
    }
    return {
      ok: true,
      prepared: prepared.value,
      targetOrigin,
      permissionAction: permissionActionFor(prepared.value.action, input.idempotencyKey),
    };
  }
}

function normalizeHandoffRequest(
  input: RuntimeBrowserHandoffRequest,
): RuntimeBrowserHandoffRequest {
  const id = (value: string, code: string): string => {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized.length > 256 || /\s/.test(normalized)) {
      throw new RuntimeBrowserHandoffError(code, 'Browser handoff identifier is invalid.');
    }
    return normalized;
  };
  if (!['login', 'captcha', 'payment', 'device-confirmation', 'manual'].includes(input.reason)) {
    throw new RuntimeBrowserHandoffError(
      'browser.handoff-reason-invalid',
      'Browser handoff reason is invalid.',
    );
  }
  if (input.onCancel !== 'keep-open' && input.onCancel !== 'close-page') {
    throw new RuntimeBrowserHandoffError(
      'browser.handoff-cancel-disposition-invalid',
      'Browser handoff cancel lifecycle is invalid.',
    );
  }
  const requestedOutcome = String(input.requestedOutcome ?? '').trim();
  if (!requestedOutcome || requestedOutcome.length > 1_000) {
    throw new RuntimeBrowserHandoffError(
      'browser.handoff-outcome-invalid',
      'Browser handoff requested outcome must contain 1-1000 characters.',
    );
  }
  return {
    workspaceId: id(input.workspaceId, 'browser.handoff-workspace-invalid'),
    runId: id(input.runId, 'browser.handoff-run-invalid'),
    ownerId: id(input.ownerId, 'browser.handoff-owner-invalid'),
    idempotencyKey: id(input.idempotencyKey, 'browser.handoff-idempotency-invalid'),
    reason: input.reason,
    requestedOutcome,
    onCancel: input.onCancel,
    ...(input.agentVersionId
      ? { agentVersionId: id(input.agentVersionId, 'browser.handoff-agent-version-invalid') }
      : {}),
    ...(input.stepId ? { stepId: id(input.stepId, 'browser.handoff-step-invalid') } : {}),
  };
}

function assertHandoffRevision(value: number): void {
  if (value !== 1) {
    throw new RuntimeBrowserHandoffError(
      'browser.handoff-revision-conflict',
      'Browser handoff revision is stale.',
    );
  }
}

function handoffArgs(command: BrowserCommandRecord): {
  reason: BrowserHandoffReason;
  requestedOutcome: string;
  onCancel: BrowserHandoffCancelDisposition;
  stepId?: string;
  agentVersionId?: string;
} {
  const args = command.sanitizedArgs;
  const reason = args.reason;
  const requestedOutcome = args.requestedOutcome;
  const onCancel = args.onCancel;
  if (
    !['login', 'captcha', 'payment', 'device-confirmation', 'manual'].includes(String(reason)) ||
    typeof requestedOutcome !== 'string' ||
    (onCancel !== 'keep-open' && onCancel !== 'close-page')
  ) {
    throw new RuntimeBrowserHandoffError(
      'browser.handoff-checkpoint-invalid',
      'Browser handoff checkpoint arguments are invalid.',
    );
  }
  return {
    reason: reason as BrowserHandoffReason,
    requestedOutcome,
    onCancel,
    ...(typeof args.stepId === 'string' ? { stepId: args.stepId } : {}),
    ...(typeof args.agentVersionId === 'string' ? { agentVersionId: args.agentVersionId } : {}),
  };
}

function handoffSummary(command: BrowserCommandRecord): RuntimeBrowserHandoffSummary {
  const args = handoffArgs(command);
  return {
    handoffId: command.id,
    revision: 1,
    workspaceId: command.workspaceId,
    runId: command.runId,
    ...(args.stepId ? { stepId: args.stepId } : {}),
    ...(args.agentVersionId ? { agentVersionId: args.agentVersionId } : {}),
    siteOrigin: command.targetOrigin,
    reason: args.reason,
    requestedOutcome: args.requestedOutcome,
    onCancel: args.onCancel,
    status: 'waiting_user',
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
    canContinue: true,
    canCancel: true,
  };
}

function handoffContinuedResult(command: BrowserCommandRecord): Record<string, unknown> {
  return {
    ok: true,
    status: 'continued',
    message: 'The user completed the requested operation in the system browser.',
    handoffId: command.id,
    siteOrigin: command.targetOrigin,
  };
}

function grantScopes(input: RuntimeBrowserPermissionInput): BrowserGrantScope[] {
  if (input.agentVersionId) {
    return [{ scopeType: 'agent-version', scopeId: input.agentVersionId }];
  }
  return [
    { scopeType: 'run', scopeId: input.runId },
    { scopeType: 'workspace', scopeId: input.workspaceId },
  ];
}

function decisionGrantScope(input: RuntimeBrowserPermissionInput): BrowserGrantScope {
  return input.agentVersionId
    ? { scopeType: 'agent-version', scopeId: input.agentVersionId }
    : { scopeType: 'run', scopeId: input.runId };
}

function isOriginAllowedBySnapshot(targetOrigin: string, permissions: readonly string[]): boolean {
  const target = new URL(targetOrigin);
  return permissions.some((permission) => {
    const value = permission.trim();
    if (!value) return false;
    if (value === '*') return true;
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.origin === target.origin
      );
    } catch {
      const legacyHost = value.toLowerCase().replace(/^\[|\]$/g, '');
      return target.hostname.toLowerCase() === legacyHost;
    }
  });
}

function permissionActionFor(action: BrowserAction, idempotencyKey: string): string {
  if (action.kind === 'click' || action.kind === 'fill') {
    const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
    return `${action.kind}:${digest}`;
  }
  return action.kind;
}

function prepareBrowserAction(
  toolName: string,
  argumentsJson: string,
): { ok: true; value: PreparedBrowserAction } | { ok: false; code: string; error: string } {
  if (toolName === 'browser_open') {
    const validated = validateChatBrowserOpen(argumentsJson);
    if (!validated.ok) {
      return { ok: false, code: 'browser.arguments-invalid', error: validated.error };
    }
    const parsed = new URL(validated.url);
    return {
      ok: true,
      value: {
        action: { kind: 'navigate', url: validated.url },
        openedOrigin: parsed.origin,
        auditArgs: { url: urlForAudit(parsed) },
      },
    };
  }

  const validated = validateChatBrowserCommand(toolName, argumentsJson);
  if (!validated.ok) {
    return { ok: false, code: 'browser.arguments-invalid', error: validated.error };
  }
  const args = validated.command.args;
  switch (validated.command.action) {
    case 'browser_click':
      return {
        ok: true,
        value: {
          action: {
            kind: 'click',
            ...(typeof args.selector === 'string' ? { selector: args.selector } : {}),
            ...(typeof args.text === 'string' ? { text: args.text } : {}),
            ...(typeof args.x === 'number' ? { x: Number(args.x) } : {}),
            ...(typeof args.y === 'number' ? { y: Number(args.y) } : {}),
          },
          auditArgs: {
            ...(typeof args.selector === 'string' ? { selector: args.selector } : {}),
            ...(typeof args.text === 'string' ? { text: args.text } : {}),
            ...(typeof args.x === 'number' ? { x: Number(args.x) } : {}),
            ...(typeof args.y === 'number' ? { y: Number(args.y) } : {}),
          },
        },
      };
    case 'browser_type':
      return {
        ok: true,
        value: {
          action: {
            kind: 'fill',
            selector: String(args.selector),
            text: String(args.text),
          },
          auditArgs: {
            selector: String(args.selector),
            textLength: String(args.text).length,
          },
        },
      };
    case 'browser_read':
      return {
        ok: true,
        value: {
          action:
            typeof args.selector === 'string'
              ? { kind: 'read', selector: args.selector }
              : { kind: 'read' },
          auditArgs: typeof args.selector === 'string' ? { selector: args.selector } : {},
        },
      };
    case 'browser_screenshot':
      return {
        ok: true,
        value: { action: { kind: 'screenshot' }, auditArgs: {} },
      };
  }
}

function resultMetadata(output: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ok: output.ok !== false };
  for (const key of [
    'message',
    'commandId',
    'ownerId',
    'agentVersionId',
    'stepId',
    'profileId',
    'leaseId',
    'pageId',
    'targetOrigin',
  ]) {
    if (typeof output[key] === 'string') metadata[key] = String(output[key]).slice(0, 512);
  }
  if (typeof output.url === 'string') {
    try {
      const parsed = new URL(output.url);
      metadata.url = `${parsed.origin}${parsed.pathname}`.slice(0, 2048);
    } catch {
      // Never persist an unparseable URL.
    }
  }
  return metadata;
}

function leaseIdentity(
  output: Record<string, unknown>,
): { leaseId: string; pageId: string } | undefined {
  return typeof output.leaseId === 'string' && typeof output.pageId === 'string'
    ? { leaseId: output.leaseId, pageId: output.pageId }
    : undefined;
}

function browserErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asFailureClass(value: string | undefined): BrowserFailureClass {
  return value === 'timeout' ||
    value === 'crashed' ||
    value === 'permission' ||
    value === 'acceptance'
    ? value
    : 'unknown';
}

function urlForAudit(parsed: URL): string {
  return `${parsed.origin}${parsed.pathname}`;
}

function failureJson(code: string, error: string, failureClass: BrowserFailureClass): string {
  return JSON.stringify({ ok: false, code, error, failureClass });
}
