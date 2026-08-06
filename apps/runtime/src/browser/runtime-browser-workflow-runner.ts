import type {
  BrowserGrantScope,
  BrowserOriginGrantRecord,
  SqliteBrowserStore,
} from '@sync-think/storage';
import type {
  BrowserAction,
  BrowserHostLike,
  BrowserLeaseInfo,
} from '@sync-think/workers';
import type { BrowserRecordingStepInput } from '@sync-think/shared';
import {
  collectStepOrigins,
  collectStepVariables,
  recordingStepToBrowserAction,
} from '@sync-think/workers';

export type BrowserWorkflowReplayFailureClass =
  | 'timeout'
  | 'crashed'
  | 'permission'
  | 'acceptance'
  | 'unknown';

export interface BrowserWorkflowReplayResult {
  ok: boolean;
  workflowVersionId: string;
  taskId: string;
  profileId: string;
  stepCount: number;
  executedStepCount: number;
  steps: BrowserWorkflowReplayStepResult[];
  errorCode?: string;
  error?: string;
  failureClass?: BrowserWorkflowReplayFailureClass;
}

export interface BrowserWorkflowReplayStepResult {
  sequence: number;
  ok: boolean;
  step: BrowserRecordingStepInput;
  actionKind?: string;
  outputUrl?: string;
  outputTitle?: string;
  errorCode?: string;
  error?: string;
}

export interface BrowserWorkflowReplayInput {
  workflowVersionId: string;
  taskId: string;
  profileId: string;
  workspaceId: string;
  ownerId: string;
  runId?: string;
  capabilityToken: string;
  signal: AbortSignal;
  /** Variable values used to resolve variable-marked recorded inputs. */
  variables?: Readonly<Record<string, string>>;
  /** Approved origin grants to evaluate. scopeType must be 'workflow'. */
  approvalGrant?: BrowserOriginGrantRecord;
}

export interface BrowserWorkflowRunnerOptions {
  store: SqliteBrowserStore;
  host: BrowserHostLike;
  fallbackWorkingDir?: string;
  profileId?: string;
}

export class BrowserWorkflowRunnerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly failureClass: BrowserWorkflowReplayFailureClass = 'unknown',
  ) {
    super(message);
    this.name = 'BrowserWorkflowRunnerError';
  }
}

/**
 * Replays a published Browser Workflow Version step-by-step against the
 * Profile's persistent page. The page is reused across steps via a single
 * lease, matching how a human would operate one browser tab.
 */
export class BrowserWorkflowRunner {
  private readonly store: SqliteBrowserStore;
  private readonly host: BrowserHostLike;
  private readonly fallbackWorkingDir: string;

  constructor(options: BrowserWorkflowRunnerOptions) {
    this.store = options.store;
    this.host = options.host;
    this.fallbackWorkingDir = options.fallbackWorkingDir ?? process.cwd();
  }

  /**
   * Check whether replay is allowed for the workflow's origins under the
   * 'workflow' scope. Returns the set of origins that still need approval.
   */
  checkPermissions(
    workflowVersionId: string,
    taskId: string,
  ): { allowed: boolean; missingOrigins: string[]; origins: string[] } {
    const version = this.store.getWorkflowVersion(workflowVersionId);
    if (!version) {
      throw new BrowserWorkflowRunnerError(
        'browser.workflow-version-not-found',
        'The Browser Workflow Version does not exist.',
      );
    }
    const origins = collectStepOrigins(version.steps);
    const scope: BrowserGrantScope = { scopeType: 'workflow', scopeId: taskId };
    const missingOrigins: string[] = [];
    for (const origin of origins) {
      const decision = this.store.resolveOriginDecision({
        scopes: [scope],
        origin,
        action: 'navigate',
      });
      if (decision.decision !== 'allow') missingOrigins.push(origin);
    }
    return { allowed: missingOrigins.length === 0, missingOrigins, origins };
  }

  /** Record a workflow-scope approval grant for a set of origins. */
  recordApproval(
    taskId: string,
    origins: readonly string[],
    approvalId: string,
  ): void {
    for (const origin of origins) {
      this.store.upsertOriginGrant({
        scopeType: 'workflow',
        scopeId: taskId,
        origin,
        action: 'navigate',
        decision: 'allow',
        approvalId,
      });
    }
  }

  async replay(input: BrowserWorkflowReplayInput): Promise<BrowserWorkflowReplayResult> {
    const version = this.store.getWorkflowVersion(input.workflowVersionId);
    if (!version) {
      throw new BrowserWorkflowRunnerError(
        'browser.workflow-version-not-found',
        'The Browser Workflow Version does not exist.',
      );
    }

    const steps = version.steps;
    if (steps.length === 0) {
      throw new BrowserWorkflowRunnerError(
        'browser.workflow-steps-empty',
        'The Browser Workflow Version has no recorded steps.',
        'acceptance',
      );
    }

    // Permission: every navigation origin must have a workflow-scope allow
    // grant (or a specific approval grant supplied by the caller).
    const origins = collectStepOrigins(steps);
    const scope: BrowserGrantScope = { scopeType: 'workflow', scopeId: input.taskId };
    for (const origin of origins) {
      const decision = this.store.resolveOriginDecision({
        scopes: [scope],
        origin,
        action: 'navigate',
      });
      if (decision.decision !== 'allow') {
        throw new BrowserWorkflowRunnerError(
          'browser.workflow-origin-grant-required',
          `The workflow needs approval to navigate to ${origin}.`,
          'permission',
        );
      }
    }

    // Resolve variable references up front so a missing variable fails fast
    // before any browser side effect happens.
    const variableNames = collectStepVariables(steps);
    const missingVariables = variableNames.filter((name) => input.variables?.[name] === undefined);
    if (missingVariables.length > 0) {
      throw new BrowserWorkflowRunnerError(
        'browser.workflow-variables-required',
        `This Workflow needs values for variable(s): ${missingVariables.join(', ')}.`,
        'acceptance',
      );
    }

    // Translate every step up front so a non-replayable step fails fast,
    // before any browser side effect happens.
    const translated: Array<{ step: BrowserRecordingStepInput; action: BrowserAction }> = [];
    for (const step of steps) {
      const playback = recordingStepToBrowserAction(step, input.variables);
      if (!playback.ok) {
        if (playback.kind === 'variable') {
          throw new BrowserWorkflowRunnerError(
            'browser.workflow-variables-required',
            `This Workflow needs a value for variable "${playback.name}".`,
            'acceptance',
          );
        }
        throw new BrowserWorkflowRunnerError(
          playback.code,
          playback.error,
          'acceptance',
        );
      }
      translated.push({ step, action: playback.action });
    }

    const profileId = input.profileId.trim();
    if (!profileId) {
      throw new BrowserWorkflowRunnerError(
        'browser.profile-id-required',
        'A Browser Profile id is required to replay a workflow.',
      );
    }

    const ownerId = input.ownerId.trim();

    const stepResults: BrowserWorkflowReplayStepResult[] = [];
    let lease: BrowserLeaseInfo | undefined;
    try {
      lease = await this.host.acquireLease({ profileId, ownerId, mode: 'command' });

      for (let index = 0; index < translated.length; index += 1) {
        if (input.signal.aborted) {
          throw new BrowserWorkflowRunnerError(
            'browser.workflow-aborted',
            'Browser Workflow replay was cancelled.',
            'acceptance',
          );
        }
        const { step, action } = translated[index];
        try {
          const result = await this.host.execute({
            leaseId: lease.leaseId,
            action,
            allowedSites: origins,
            timeoutMs: 30_000,
            projectRoot: this.fallbackWorkingDir,
            signal: input.signal,
          });
          stepResults.push({
            sequence: index + 1,
            ok: true,
            step,
            actionKind: action.kind,
            outputUrl: result.url,
            outputTitle: result.title,
          });
        } catch (error) {
          const failure = normalizeReplayError(error, input.signal);
          stepResults.push({
            sequence: index + 1,
            ok: false,
            step,
            actionKind: action.kind,
            errorCode: failure.code,
            error: failure.message,
          });
          return {
            ok: false,
            workflowVersionId: input.workflowVersionId,
            taskId: input.taskId,
            profileId,
            stepCount: steps.length,
            executedStepCount: index + 1,
            steps: stepResults,
            errorCode: failure.code,
            error: failure.message,
            failureClass: failure.failureClass,
          };
        }
      }

      return {
        ok: true,
        workflowVersionId: input.workflowVersionId,
        taskId: input.taskId,
        profileId,
        stepCount: steps.length,
        executedStepCount: steps.length,
        steps: stepResults,
      };
    } catch (error) {
      const failure = normalizeReplayError(error, input.signal);
      return {
        ok: false,
        workflowVersionId: input.workflowVersionId,
        taskId: input.taskId,
        profileId,
        stepCount: steps.length,
        executedStepCount: stepResults.length,
        steps: stepResults,
        errorCode: failure.code,
        error: failure.message,
        failureClass: failure.failureClass,
      };
    } finally {
      if (lease) {
        await this.host.releaseLease(lease.leaseId, { closePage: false }).catch(() => undefined);
      }
    }
  }
}

function normalizeReplayError(
  error: unknown,
  signal?: AbortSignal,
): { code: string; message: string; failureClass: BrowserWorkflowReplayFailureClass } {
  if (signal?.aborted) {
    return { code: 'browser.workflow-aborted', message: 'Browser Workflow replay was cancelled.', failureClass: 'acceptance' };
  }
  const candidate = error as { code?: unknown; message?: unknown; failureClass?: unknown };
  if (candidate && typeof candidate === 'object') {
    const code = typeof candidate.code === 'string' ? candidate.code : undefined;
    const message = typeof candidate.message === 'string' ? candidate.message : undefined;
    if (code && message) {
      const failureClass: BrowserWorkflowReplayFailureClass =
        typeof candidate.failureClass === 'string' &&
        ['timeout', 'crashed', 'permission', 'acceptance', 'unknown'].includes(candidate.failureClass)
          ? (candidate.failureClass as BrowserWorkflowReplayFailureClass)
          : 'unknown';
      return { code, message, failureClass };
    }
  }
  return {
    code: 'browser.workflow-replay-failed',
    message: error instanceof Error ? error.message : 'Browser Workflow replay failed.',
    failureClass: 'unknown',
  };
}
