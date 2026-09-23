import type {
  BrowserAutomationTaskRecord,
  BrowserWorkflowDraftRecord,
  BrowserWorkflowReviewRecord,
  BrowserWorkflowRunRecord,
  BrowserWorkflowScheduleRecord,
  BrowserWorkflowVersionRecord,
  SqliteBrowserStore,
} from '@sync-think/storage';
import type {
  BrowserAutomationTaskSummary,
  BrowserProfileSummary,
  BrowserWorkflowDraftSummary,
  BrowserWorkflowReviewSummary,
  BrowserWorkflowVersionSummary,
  CreateBrowserWorkflowDraftPayload,
  CreateBrowserWorkflowDraftResponse,
  CreateBrowserWorkflowRevisionDraftPayload,
  CreateBrowserWorkflowRevisionDraftResponse,
  GetBrowserWorkflowResponse,
  ListBrowserWorkflowsPayload,
  ReviewBrowserWorkflowDraftPayload,
  ReviewBrowserWorkflowDraftResponse,
  SaveBrowserWorkflowDraftPayload,
  SaveBrowserWorkflowDraftResponse,
  PublishBrowserWorkflowDraftPayload,
  PublishBrowserWorkflowDraftResponse,
  ImportChatBrowserWorkflowPayload,
  ImportChatBrowserWorkflowResponse,
  SubmitBrowserWorkflowDraftPayload,
  SubmitBrowserWorkflowDraftResponse,
  UpdateBrowserWorkflowSchedulePayload,
  UpdateBrowserWorkflowScheduleResponse,
} from '@sync-think/protocol';

export interface RuntimeBrowserWorkflowServiceOptions {
  store: SqliteBrowserStore;
  listProfiles?: () => readonly BrowserProfileSummary[];
}

export class RuntimeBrowserWorkflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'RuntimeBrowserWorkflowError';
  }
}

export class RuntimeBrowserWorkflowService {
  private readonly store: SqliteBrowserStore;
  private readonly listProfileSummaries?: () => readonly BrowserProfileSummary[];

  constructor(options: RuntimeBrowserWorkflowServiceOptions) {
    this.store = options.store;
    this.listProfileSummaries = options.listProfiles;
  }

  listProfiles(): readonly BrowserProfileSummary[] {
    if (this.listProfileSummaries) return this.listProfileSummaries();
    return this.store.listProfiles().map((profile) => ({
      id: profile.id,
      name: profile.name,
      revision: profile.revision,
      isDefault: profile.isDefault,
      inUse:
        this.store.hasActiveProfileCommands(profile.id) ||
        this.store.hasActiveProfileRecording(profile.id),
      siteCount: profile.siteCount,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      ...(profile.lastUsedAt ? { lastUsedAt: profile.lastUsedAt } : {}),
    }));
  }

  assignWorkspace(input: import('@sync-think/protocol').AssignBrowserWorkflowWorkspacePayload): { task: BrowserAutomationTaskSummary } {
    return this.translateErrors(() => ({ task: toPublicTask(this.store.assignAutomationTaskWorkspace(input)) }));
  }

  listWorkflows(input: ListBrowserWorkflowsPayload): BrowserAutomationTaskSummary[] {
    return this.translateErrors(() => this.store.listAutomationTasks(input).map(toPublicTask));
  }

  getWorkflow(input: { taskId: string }): GetBrowserWorkflowResponse {
    return this.translateErrors(() => {
      const task = this.store.getAutomationTask(input.taskId);
      if (!task) {
        throw new RuntimeBrowserWorkflowError(
          'browser.workflow-not-found',
          'The requested Browser automation task does not exist.',
        );
      }
      const draft = task.currentDraftId
        ? this.store.getWorkflowDraft(task.currentDraftId)
        : undefined;
      const version = task.publishedVersionId
        ? this.store.getWorkflowVersion(task.publishedVersionId)
        : undefined;
      const reviewPage = this.store.listWorkflowReviewsForTask(task.id);
      const schedule = this.store.getWorkflowSchedule(task.id);
      return {
        task: toPublicTask(task),
        ...(draft ? { draft: toPublicDraft(draft) } : {}),
        ...(version ? { version: toPublicVersion(version) } : {}),
        reviews: reviewPage.reviews.map(toPublicReview),
        reviewsTruncated: reviewPage.truncated,
        recentRuns: this.store.listWorkflowRuns(task.id, 10).map(toPublicRun),
        ...(schedule ? { schedule: toPublicSchedule(schedule) } : {}),
      };
    });
  }

  createDraft(input: CreateBrowserWorkflowDraftPayload): CreateBrowserWorkflowDraftResponse {
    return this.translateErrors(() => {
      const result = this.store.createAutomationTaskDraft(input);
      return {
        task: toPublicTask(result.task),
        draft: toPublicDraft(result.draft),
      };
    });
  }

  createRevisionDraft(
    input: CreateBrowserWorkflowRevisionDraftPayload,
  ): CreateBrowserWorkflowRevisionDraftResponse {
    return this.translateErrors(() => {
      const result = this.store.createWorkflowRevisionDraft(input);
      return {
        task: toPublicTask(result.task),
        draft: toPublicDraft(result.draft),
      };
    });
  }

  submitDraft(input: SubmitBrowserWorkflowDraftPayload): SubmitBrowserWorkflowDraftResponse {
    return this.translateErrors(() => {
      const result = this.store.submitWorkflowDraft(input);
      return {
        task: toPublicTask(result.task),
        draft: toPublicDraft(result.draft),
      };
    });
  }

  saveDraft(input: SaveBrowserWorkflowDraftPayload): SaveBrowserWorkflowDraftResponse {
    return this.translateErrors(() => {
      const result = this.store.saveWorkflowDraft(input);
      return {
        task: toPublicTask(result.task),
        draft: toPublicDraft(result.draft),
      };
    });
  }

  publishDraft(input: PublishBrowserWorkflowDraftPayload): PublishBrowserWorkflowDraftResponse {
    return this.translateErrors(() => {
      const result = this.store.publishWorkflowDraft(input);
      return {
        task: toPublicTask(result.task),
        draft: toPublicDraft(result.draft),
        version: toPublicVersion(result.version),
      };
    });
  }

  importChatWorkflow(input: ImportChatBrowserWorkflowPayload): ImportChatBrowserWorkflowResponse {
    return this.translateErrors(() => {
      const result = this.store.importChatAutomationTask(input);
      return {
        task: toPublicTask(result.task),
        draft: toPublicDraft(result.draft),
        ...(result.version ? { version: toPublicVersion(result.version) } : {}),
      };
    });
  }

  reviewDraft(input: ReviewBrowserWorkflowDraftPayload): ReviewBrowserWorkflowDraftResponse {
    return this.translateErrors(() => {
      const result = this.store.reviewWorkflowDraft(input);
      return {
        task: toPublicTask(result.task),
        draft: toPublicDraft(result.draft),
        ...(result.version ? { version: toPublicVersion(result.version) } : {}),
      };
    });
  }

  updateSchedule(
    input: UpdateBrowserWorkflowSchedulePayload,
  ): UpdateBrowserWorkflowScheduleResponse {
    return this.translateErrors(() => {
      const task = this.store.getAutomationTask(input.taskId);
      if (!task?.publishedVersionId) {
        throw new RuntimeBrowserWorkflowError(
          'browser.workflow-not-ready',
          'Publish a Browser Workflow Version before enabling its schedule.',
        );
      }
      const version = this.store.getWorkflowVersion(task.publishedVersionId);
      const needsRuntimeInput = version?.steps.some(
        (step) => (step.kind === 'fill' || step.kind === 'select') && step.value.kind !== 'literal',
      );
      if (input.enabled && needsRuntimeInput) {
        throw new RuntimeBrowserWorkflowError(
          'browser.workflow-schedule-input-required',
          'Scheduled workflows cannot contain variable or secret inputs.',
        );
      }
      return {
        schedule: toPublicSchedule(this.store.upsertWorkflowSchedule(input)),
      };
    });
  }

  private translateErrors<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof RuntimeBrowserWorkflowError) throw error;
      const internalCode = browserWorkflowInternalErrorCode(error);
      if (
        internalCode === 'browser.task_not_found' ||
        internalCode === 'browser.workflow_draft_not_found' ||
        internalCode === 'browser.workflow_version_not_found' ||
        internalCode === 'browser.recording_not_found'
      ) {
        throw new RuntimeBrowserWorkflowError(
          'browser.workflow-not-found',
          'The requested Browser workflow resource does not exist.',
          { cause: error },
        );
      }
      if (
        internalCode === 'browser.workflow_draft_state_conflict' ||
        internalCode === 'browser.workflow_recording_mismatch' ||
        internalCode === 'browser.workflow_recording_profile_mismatch' ||
        internalCode === 'browser.workflow_recording_not_stopped' ||
        internalCode === 'browser.workflow_steps_empty' ||
        internalCode === 'browser.task_revision_conflict'
      ) {
        throw new RuntimeBrowserWorkflowError(
          'browser.workflow-conflict',
          'The Browser workflow is not ready for this operation.',
          { cause: error },
        );
      }
      throw error;
    }
  }
}

function toPublicTask(task: BrowserAutomationTaskRecord): BrowserAutomationTaskSummary {
  return {
    ...(task.workspaceId ? { workspaceId: task.workspaceId } : {}),
    ...(task.workspaceId ? { workspaceId: task.workspaceId } : {}),
    id: task.id,
    profileId: task.profileId,
    name: task.name,
    instruction: task.instruction,
    startUrl: task.startUrl,
    source: task.source,
    status: task.status,
    revision: task.revision,
    ...(task.currentDraftId ? { currentDraftId: task.currentDraftId } : {}),
    ...(task.publishedVersionId ? { publishedVersionId: task.publishedVersionId } : {}),
    ...(task.lastRunAt ? { lastRunAt: task.lastRunAt } : {}),
    successCount: task.successCount,
    failureCount: task.failureCount,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function toPublicDraft(draft: BrowserWorkflowDraftRecord): BrowserWorkflowDraftSummary {
  return {
    id: draft.id,
    taskId: draft.taskId,
    ...(draft.recordingId ? { recordingId: draft.recordingId } : {}),
    status: draft.status,
    revision: draft.revision,
    steps: draft.steps,
    stepCount: draft.stepCount,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    ...(draft.submittedAt ? { submittedAt: draft.submittedAt } : {}),
    ...(draft.reviewedAt ? { reviewedAt: draft.reviewedAt } : {}),
  };
}

function toPublicVersion(version: BrowserWorkflowVersionRecord): BrowserWorkflowVersionSummary {
  return {
    id: version.id,
    taskId: version.taskId,
    draftId: version.draftId,
    versionNumber: version.versionNumber,
    steps: version.steps,
    stepCount: version.stepCount,
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
  };
}

function toPublicReview(review: BrowserWorkflowReviewRecord): BrowserWorkflowReviewSummary {
  return {
    id: review.id,
    draftId: review.draftId,
    decision: review.decision,
    ...(review.note ? { note: review.note } : {}),
    createdAt: review.createdAt,
  };
}

function toPublicRun(run: BrowserWorkflowRunRecord) {
  return {
    id: run.id,
    taskId: run.taskId,
    versionId: run.versionId,
    trigger: run.trigger,
    status: run.status,
    stepCount: run.stepCount,
    executedStepCount: run.executedStepCount,
    ...(run.failedStepSequence ? { failedStepSequence: run.failedStepSequence } : {}),
    ...(run.errorCode ? { errorCode: run.errorCode } : {}),
    ...(run.error ? { error: run.error } : {}),
    startedAt: run.startedAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    steps: run.steps.map((step) => ({
      sequence: step.sequence,
      ok: step.status === 'succeeded',
      actionKind: step.actionKind,
      ...(step.outputUrl ? { outputUrl: step.outputUrl } : {}),
      ...(step.outputTitle ? { outputTitle: step.outputTitle } : {}),
      ...(step.screenshotRelativePath
        ? { screenshotRelativePath: step.screenshotRelativePath }
        : {}),
      ...(step.screenshotEmbedUrl ? { screenshotEmbedUrl: step.screenshotEmbedUrl } : {}),
      ...(step.screenshotErrorCode ? { screenshotErrorCode: step.screenshotErrorCode } : {}),
      ...(step.errorCode ? { errorCode: step.errorCode } : {}),
      ...(step.error ? { error: step.error } : {}),
    })),
  };
}

function toPublicSchedule(schedule: BrowserWorkflowScheduleRecord) {
  return {
    taskId: schedule.taskId,
    enabled: schedule.enabled,
    intervalMinutes: schedule.intervalMinutes,
    ...(schedule.nextRunAt ? { nextRunAt: schedule.nextRunAt } : {}),
    ...(schedule.lastRunAt ? { lastRunAt: schedule.lastRunAt } : {}),
    revision: schedule.revision,
    updatedAt: schedule.updatedAt,
  };
}

function browserWorkflowInternalErrorCode(error: unknown): string | undefined {
  if (error instanceof Error) {
    return /^(browser\.[a-z0-9._-]{1,120})(?::|$)/u.exec(error.message.trim())?.[1];
  }
  return undefined;
}
