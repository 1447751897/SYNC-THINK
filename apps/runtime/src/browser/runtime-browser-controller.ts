import { createHash } from 'node:crypto';
import type {
  BrowserGrantScope,
  BrowserOriginGrantRecord,
  SqliteBrowserStore,
} from '@sync-think/storage';
import type {
  BrowserAction,
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

type BrowserFailureClass = 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown';

export interface RuntimeBrowserIntent {
  commandId: string;
  idempotencyKey: string;
  toolName: string;
  profileId: string;
  ownerId: string;
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
}

export interface RuntimeBrowserPermissionInput {
  toolName: string;
  argumentsJson: string;
  workspaceId: string;
  runId: string;
  ownerId: string;
  idempotencyKey: string;
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

  constructor(options: RuntimeBrowserControllerOptions) {
    this.worker = options.worker;
    this.store = options.store;
    this.profileId = options.profileId?.trim() || 'default';
    this.fallbackWorkingDir = options.fallbackWorkingDir;
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
      scopes: grantScopes(input.workspaceId, input.runId),
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
      scopeType: 'run',
      scopeId: input.runId,
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
      command = this.store.reserveCommand({
        idempotencyKey: input.idempotencyKey,
        workspaceId: input.workspaceId,
        runId: input.runId,
        ownerId: input.ownerId,
        profileId: this.profileId,
        toolName: input.toolName,
        action: resolved.permissionAction,
        targetOrigin: resolved.targetOrigin,
        sanitizedArgs: resolved.prepared.auditArgs,
      });
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
      scopes: grantScopes(input.workspaceId, input.runId),
      origin: resolved.targetOrigin,
      action: resolved.permissionAction,
    });
    if (permission.decision === 'deny') {
      this.store.failCommand(
        command.id,
        { code: 'browser.origin-denied', failureClass: 'permission' },
      );
      return failureJson(
        'browser.origin-denied',
        'Browser permission was denied for this origin and action.',
        'permission',
      );
    }
    if (permission.decision !== 'allow' && input.approval) {
      this.store.upsertOriginGrant({
        scopeType: 'run',
        scopeId: input.runId,
        origin: resolved.targetOrigin,
        action: resolved.permissionAction,
        decision: 'allow',
        approvalId: input.approval.approvalId,
      });
      permission = this.store.resolveOriginDecision({
        scopes: grantScopes(input.workspaceId, input.runId),
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
      this.store.failCommand(
        command.id,
        { code: 'browser.screenshot-root-required', failureClass: 'permission' },
      );
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
      targetOrigin: resolved.targetOrigin,
      permissionAction: resolved.permissionAction,
      action: resolved.prepared.action,
      allowedOrigins: [resolved.targetOrigin],
      auditArgs: resolved.prepared.auditArgs,
    };
    try {
      await input.beforeExecute?.(intent);
    } catch {
      this.store.failCommand(
        command.id,
        { code: 'browser.intent-persist-failed', failureClass: 'unknown' },
      );
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
      for await (const event of this.worker.exec(workerInput, token)) {
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
          const durableOutput = resultMetadata(output);
          this.store.completeCommand(
            command.id,
            durableOutput,
            leaseIdentity(output),
          );
          return JSON.stringify(event.output);
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
    return {
      ok: true,
      prepared: prepared.value,
      targetOrigin,
      permissionAction: permissionActionFor(prepared.value.action, input.idempotencyKey),
    };
  }
}

function grantScopes(workspaceId: string, runId: string): BrowserGrantScope[] {
  return [
    { scopeType: 'run', scopeId: runId },
    { scopeType: 'workspace', scopeId: workspaceId },
  ];
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
):
  | { ok: true; value: PreparedBrowserAction }
  | { ok: false; code: string; error: string } {
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
      if (typeof args.selector === 'string') {
        return {
          ok: true,
          value: {
            action: { kind: 'click', selector: args.selector },
            auditArgs: { selector: args.selector },
          },
        };
      }
      return {
        ok: true,
        value: {
          action: { kind: 'click', x: Number(args.x), y: Number(args.y) },
          auditArgs: { x: Number(args.x), y: Number(args.y) },
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
          auditArgs:
            typeof args.selector === 'string' ? { selector: args.selector } : {},
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
  for (const key of ['message', 'profileId', 'leaseId', 'pageId']) {
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

function leaseIdentity(output: Record<string, unknown>): { leaseId: string; pageId: string } | undefined {
  return typeof output.leaseId === 'string' && typeof output.pageId === 'string'
    ? { leaseId: output.leaseId, pageId: output.pageId }
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

function failureJson(
  code: string,
  error: string,
  failureClass: BrowserFailureClass,
): string {
  return JSON.stringify({ ok: false, code, error, failureClass });
}
