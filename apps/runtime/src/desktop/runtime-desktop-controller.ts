import type { DesktopCommandRecord, SqliteDesktopStore } from '@sync-think/storage';
import { ErrorCode } from '@sync-think/shared';
import {
  createDesktopUserInputMonitor,
  type DesktopAction,
  type DesktopElementSnapshot,
  type DesktopElementTarget,
  type DesktopUserInputMonitor,
  type DesktopWorker,
  type WorkerEvent,
  type WorkerToken,
} from '@sync-think/workers';
import {
  CHAT_DESKTOP_TOOL_NAMES,
  assessChatDesktopToolRisk,
  desktopElementTargetIdentity,
  prepareChatDesktopTool,
  type DesktopActionRiskAssessment,
} from '../desktop-chat-tools.js';

type DesktopFailureClass = 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown';

export interface RuntimeDesktopIntent {
  commandId: string;
  idempotencyKey: string;
  toolName: string;
  ownerId: string;
  action: DesktopAction;
  auditArgs: Record<string, unknown>;
  targetIdentity: string;
  risk: DesktopActionRiskAssessment;
  eventArgs: Record<string, unknown>;
}

export interface RuntimeDesktopControllerOptions {
  worker?: DesktopWorker;
  workerFactory?: () => DesktopWorker;
  store: SqliteDesktopStore;
  userInputMonitor?: DesktopUserInputMonitor;
  fallbackWorkingDir?: string;
  inputPollIntervalMs?: number;
}

export interface RuntimeDesktopPermissionInput {
  executionMode?: string;
  toolName: string;
  argumentsJson: string;
}

export type RuntimeDesktopPermissionDecision =
  | {
      decision: 'allow' | 'approval-required';
      risk: DesktopActionRiskAssessment;
    }
  | {
      decision: 'deny';
      code: string;
      error: string;
      failureClass: DesktopFailureClass;
      risk?: DesktopActionRiskAssessment;
    };

export interface RuntimeDesktopExecuteInput {
  capabilityEnabled: boolean;
  workspaceId: string;
  runId: string;
  ownerId: string;
  idempotencyKey: string;
  capabilityToken: string;
  toolName: string;
  argumentsJson: string;
  executionMode?: string;
  approval?: { approvalId: string };
  workspaceRoot?: string;
  signal?: AbortSignal;
  beforeStart?: () => boolean;
  beforeExecute?(intent: RuntimeDesktopIntent): void | Promise<void>;
  onWorkerEvent?(event: WorkerEvent): void | Promise<void>;
}

export class RuntimeDesktopController {
  private worker?: DesktopWorker;
  private readonly workerFactory?: () => DesktopWorker;
  private readonly store: SqliteDesktopStore;
  private userInputMonitor?: DesktopUserInputMonitor;
  private readonly fallbackWorkingDir: string;
  private readonly inputPollIntervalMs: number;
  private readonly resolvedElements = new Map<string, DesktopElementSnapshot>();

  constructor(options: RuntimeDesktopControllerOptions) {
    this.worker = options.worker;
    this.workerFactory = options.workerFactory;
    if (!this.worker && !this.workerFactory) throw new Error('desktop.worker-unavailable');
    this.store = options.store;
    this.userInputMonitor = options.userInputMonitor;
    this.fallbackWorkingDir = options.fallbackWorkingDir ?? process.cwd();
    this.inputPollIntervalMs = Math.max(5, options.inputPollIntervalMs ?? 40);
    this.store.recoverUnknownInFlight();
  }

  listWaitingCommands(
    input: {
      workspaceId?: string;
      runId?: string;
    } = {},
  ): DesktopCommandRecord[] {
    return this.store.listWaitingCommands(input);
  }

  continueWaitingCommand(input: {
    commandId: string;
    expectedUpdatedAt: string;
  }): DesktopCommandRecord & { replayed: boolean } {
    return this.store.continueWaitingCommand({
      id: input.commandId,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
  }

  cancelWaitingCommand(input: {
    commandId: string;
    expectedUpdatedAt: string;
  }): DesktopCommandRecord & { replayed: boolean } {
    return this.store.cancelWaitingCommand({
      id: input.commandId,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
  }

  evaluatePermission(input: RuntimeDesktopPermissionInput): RuntimeDesktopPermissionDecision {
    if (!CHAT_DESKTOP_TOOL_NAMES.has(input.toolName)) {
      return {
        decision: 'deny',
        code: ErrorCode.DESKTOP_PROTOCOL_MALFORMED,
        error: 'Unsupported desktop tool: ' + input.toolName,
        failureClass: 'acceptance',
      };
    }
    const prepared = prepareChatDesktopTool(input.toolName, input.argumentsJson);
    if (!prepared) {
      return {
        decision: 'deny',
        code: ErrorCode.DESKTOP_PROTOCOL_MALFORMED,
        error: 'Invalid desktop tool arguments.',
        failureClass: 'acceptance',
      };
    }
    const element = desktopActionElementTarget(prepared.action)
      ? this.resolvedElements.get(prepared.targetIdentity)
      : undefined;
    const risk = assessChatDesktopToolRisk(prepared, element);
    if (risk.level === 'prohibited') {
      return {
        decision: 'deny',
        code: 'desktop.action-prohibited',
        error: 'This Desktop action is outside the supported automation policy.',
        failureClass: 'permission',
        risk,
      };
    }
    const mode = normalizeDesktopExecutionMode(input.executionMode);
    const requiresApproval =
      risk.level === 'human-only' ||
      risk.level === 'sensitive' ||
      (risk.level === 'display' && mode === 'ask');
    return { decision: requiresApproval ? 'approval-required' : 'allow', risk };
  }

  async execute(input: RuntimeDesktopExecuteInput): Promise<string> {
    if (!input.capabilityEnabled) {
      return failureJson(
        ErrorCode.DESKTOP_CAPABILITY_DISABLED,
        'Computer Use plugin is disabled.',
        'permission',
      );
    }
    if (!CHAT_DESKTOP_TOOL_NAMES.has(input.toolName)) {
      return failureJson(
        ErrorCode.DESKTOP_PROTOCOL_MALFORMED,
        `Unsupported desktop tool: ${input.toolName}`,
        'acceptance',
      );
    }
    const prepared = prepareChatDesktopTool(input.toolName, input.argumentsJson);
    if (!prepared) {
      return failureJson(
        ErrorCode.DESKTOP_PROTOCOL_MALFORMED,
        'Invalid desktop tool arguments.',
        'acceptance',
      );
    }
    const permission = this.evaluatePermission({
      executionMode: input.executionMode ?? 'full-access',
      toolName: input.toolName,
      argumentsJson: input.argumentsJson,
    });
    if (permission.decision === 'deny') {
      return failureJson(permission.code, permission.error, permission.failureClass);
    }
    if (permission.decision === 'approval-required' && !input.approval) {
      return failureJson(
        'desktop.approval-required',
        'Human approval is required for this Desktop action.',
        'permission',
      );
    }
    const risk = permission.risk;

    let command;
    try {
      command = this.store.reserveCommand({
        idempotencyKey: input.idempotencyKey,
        workspaceId: input.workspaceId,
        runId: input.runId,
        ownerId: input.ownerId,
        toolName: input.toolName,
        action: prepared.action.kind,
        targetIdentity: prepared.targetIdentity,
        sanitizedArgs: prepared.sanitizedArgs,
      });
    } catch (error) {
      return failureJson(
        'desktop.command-persist-failed',
        error instanceof Error && error.message === 'desktop.command_idempotency_mismatch'
          ? 'Desktop command idempotency key was reused with different input.'
          : 'Desktop command could not be persisted; no desktop action was started.',
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
          command.errorCode ?? 'desktop.command-failed',
          'The persisted Desktop command already failed and was not retried.',
          asFailureClass(command.failureClass),
          command.id,
        );
      }
      if (command.state !== 'waiting_user') {
        command = this.store.markWaitingUser(
          command.id,
          ErrorCode.DESKTOP_COMMAND_INSPECTION_REQUIRED,
        );
      }
      return failureJson(
        command.errorCode ?? ErrorCode.DESKTOP_COMMAND_INSPECTION_REQUIRED,
        'The persisted Desktop command requires human inspection and was not retried.',
        'permission',
        command.id,
      );
    }

    try {
      this.store.markApproved(command.id);
    } catch {
      return failureJson(
        'desktop.command-transition-failed',
        'Desktop command state could not be approved; no desktop action was started.',
        'unknown',
        command.id,
      );
    }

    let baselineInputTick: number | undefined;
    if (prepared.mutating) {
      try {
        baselineInputTick = this.getUserInputMonitor().sample();
      } catch {
        this.store.failCommand(command.id, {
          code: ErrorCode.DESKTOP_INPUT_MONITOR_UNAVAILABLE,
          failureClass: 'permission',
        });
        return failureJson(
          ErrorCode.DESKTOP_INPUT_MONITOR_UNAVAILABLE,
          'Desktop input monitoring is unavailable; no mutating action was started.',
          'permission',
          command.id,
        );
      }
    }

    try {
      this.store.markRunning(command.id);
    } catch {
      return failureJson(
        'desktop.command-transition-failed',
        'Desktop command state could not be advanced; no desktop action was started.',
        'unknown',
        command.id,
      );
    }

    const intent: RuntimeDesktopIntent = {
      commandId: command.id,
      idempotencyKey: input.idempotencyKey,
      toolName: input.toolName,
      ownerId: input.ownerId,
      action: prepared.action,
      auditArgs: prepared.sanitizedArgs,
      targetIdentity: prepared.targetIdentity,
      risk,
      eventArgs: risk.approvalArguments,
    };
    try {
      await input.beforeExecute?.(intent);
    } catch {
      this.store.failCommand(command.id, {
        code: 'desktop.intent-persist-failed',
        failureClass: 'unknown',
      });
      return failureJson(
        'desktop.intent-persist-failed',
        'Desktop intent could not be persisted; no desktop action was started.',
        'unknown',
        command.id,
      );
    }

    const linked = createLinkedAbortController(input.signal);
    let inputDetected = false;
    let inputMonitorUnavailable = false;
    const sampleInputFence = (): boolean => {
      if (!prepared.mutating || baselineInputTick === undefined) return true;
      try {
        if (this.getUserInputMonitor().sample() === baselineInputTick) return true;
        inputDetected = true;
      } catch {
        inputMonitorUnavailable = true;
      }
      linked.controller.abort();
      return false;
    };
    const interval = prepared.mutating
      ? setInterval(() => {
          sampleInputFence();
        }, this.inputPollIntervalMs)
      : undefined;
    interval?.unref();

    const workingDir = input.workspaceRoot?.trim() || this.fallbackWorkingDir;
    const token: WorkerToken = {
      token: input.capabilityToken,
      allowedRoot: workingDir,
      timeoutMs: 30_000,
      maxOutputBytes: 1024 * 1024,
      signal: linked.controller.signal,
      beforeStart: () =>
        !linked.controller.signal.aborted && (input.beforeStart?.() ?? true) && sampleInputFence(),
    };

    try {
      for await (const event of this.getWorker().exec(
        { workingDir, action: prepared.action },
        token,
      )) {
        await input.onWorkerEvent?.(event);
        if (event.type === 'failed') {
          if (inputDetected) return this.waitForUserInput(command.id);
          if (inputMonitorUnavailable) return this.failInputMonitor(command.id);
          this.store.failCommand(command.id, {
            code: event.error.code,
            failureClass: event.failureClass,
          });
          return failureJson(event.error.code, event.error.message, event.failureClass, command.id);
        }
        if (event.type === 'completed') {
          if (inputDetected) return this.waitForUserInput(command.id);
          if (inputMonitorUnavailable) return this.failInputMonitor(command.id);
          const output = asObject(event.output) ?? { ok: true };
          const enriched = { ...output, commandId: command.id };
          this.rememberResolvedElement(output);
          this.store.completeCommand(command.id, enriched);
          return JSON.stringify(enriched);
        }
      }
      if (inputDetected) return this.waitForUserInput(command.id);
      if (inputMonitorUnavailable) return this.failInputMonitor(command.id);
      this.store.failCommand(command.id, {
        code: 'desktop.worker-no-terminal-event',
        failureClass: 'crashed',
      });
      return failureJson(
        'desktop.worker-no-terminal-event',
        'Desktop Worker ended without a terminal event.',
        'crashed',
        command.id,
      );
    } catch (error) {
      if (inputDetected) return this.waitForUserInput(command.id);
      if (inputMonitorUnavailable) return this.failInputMonitor(command.id);
      const aborted = linked.controller.signal.aborted;
      const code = aborted ? ErrorCode.DESKTOP_CANCELLED : 'desktop.worker-failed';
      const failureClass: DesktopFailureClass = aborted ? 'acceptance' : 'unknown';
      this.store.failCommand(command.id, { code, failureClass });
      return failureJson(
        code,
        aborted
          ? 'Desktop action was cancelled.'
          : error instanceof Error
            ? error.message
            : 'Desktop Worker failed.',
        failureClass,
        command.id,
      );
    } finally {
      if (interval) clearInterval(interval);
      linked.dispose();
    }
  }

  private getWorker(): DesktopWorker {
    this.worker ??= this.workerFactory?.();
    if (!this.worker) throw new Error('desktop.worker-unavailable');
    return this.worker;
  }

  private getUserInputMonitor(): DesktopUserInputMonitor {
    this.userInputMonitor ??= createDesktopUserInputMonitor();
    return this.userInputMonitor;
  }

  private waitForUserInput(commandId: string): string {
    this.store.markWaitingUser(commandId, ErrorCode.DESKTOP_USER_INPUT_DETECTED);
    return failureJson(
      ErrorCode.DESKTOP_USER_INPUT_DETECTED,
      'Desktop action stopped because user keyboard or mouse input was detected.',
      'permission',
      commandId,
    );
  }

  private rememberResolvedElement(output: Record<string, unknown>): void {
    const result = asObject(output.result);
    if (result?.kind !== 'element-resolved') return;
    const target = asDesktopElementTarget(result.target);
    const element = asDesktopElementSnapshot(result.element);
    if (!target || !element) return;
    this.resolvedElements.set(desktopElementTargetIdentity(target), element);
    while (this.resolvedElements.size > 512) {
      const oldest = this.resolvedElements.keys().next().value as string | undefined;
      if (!oldest) break;
      this.resolvedElements.delete(oldest);
    }
  }

  private failInputMonitor(commandId: string): string {
    this.store.failCommand(commandId, {
      code: ErrorCode.DESKTOP_INPUT_MONITOR_UNAVAILABLE,
      failureClass: 'permission',
    });
    return failureJson(
      ErrorCode.DESKTOP_INPUT_MONITOR_UNAVAILABLE,
      'Desktop input monitoring became unavailable; the mutating action was stopped.',
      'permission',
      commandId,
    );
  }
}

function normalizeDesktopExecutionMode(
  mode: string | undefined,
): 'ask' | 'workspace' | 'full-access' {
  const normalized = String(mode ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'ask' || normalized === 'read-only' || normalized === 'readonly') return 'ask';
  if (
    normalized === 'full-access' ||
    normalized === 'full_access' ||
    normalized === 'full' ||
    normalized === 'unrestricted'
  ) {
    return 'full-access';
  }
  return 'workspace';
}

function desktopActionElementTarget(action: DesktopAction): DesktopElementTarget | undefined {
  return action.kind === 'read-element' ||
    action.kind === 'focus-element' ||
    action.kind === 'invoke-element' ||
    action.kind === 'set-value'
    ? action.target
    : undefined;
}

function asDesktopElementTarget(value: unknown): DesktopElementTarget | undefined {
  const record = asObject(value);
  const window = asObject(record?.window);
  if (
    !record ||
    !window ||
    !Number.isSafeInteger(window.processId) ||
    typeof window.nativeWindowHandle !== 'string' ||
    typeof record.snapshotRevision !== 'string' ||
    typeof record.accessibilityRevision !== 'string' ||
    !Number.isSafeInteger(record.elementIndex)
  ) {
    return undefined;
  }
  return record as unknown as DesktopElementTarget;
}

function asDesktopElementSnapshot(value: unknown): DesktopElementSnapshot | undefined {
  const record = asObject(value);
  if (
    !record ||
    !Number.isSafeInteger(record.index) ||
    typeof record.controlType !== 'string' ||
    !Number.isSafeInteger(record.processId) ||
    typeof record.enabled !== 'boolean' ||
    typeof record.offscreen !== 'boolean' ||
    typeof record.isPassword !== 'boolean' ||
    !Array.isArray(record.supportedPatterns)
  ) {
    return undefined;
  }
  return record as unknown as DesktopElementSnapshot;
}

function createLinkedAbortController(signal?: AbortSignal): {
  controller: AbortController;
  dispose(): void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  return {
    controller,
    dispose: () => signal?.removeEventListener('abort', abort),
  };
}

function failureJson(
  code: string,
  error: string,
  failureClass: DesktopFailureClass,
  commandId?: string,
): string {
  return JSON.stringify({
    ok: false,
    code,
    error,
    failureClass,
    ...(commandId ? { commandId } : {}),
  });
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asFailureClass(value: string | undefined): DesktopFailureClass {
  return ['timeout', 'crashed', 'permission', 'acceptance', 'unknown'].includes(String(value))
    ? (value as DesktopFailureClass)
    : 'unknown';
}
