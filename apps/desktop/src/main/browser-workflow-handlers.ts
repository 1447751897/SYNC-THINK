import type {
  BrowserWorkflowCommand,
  BrowserWorkflowCommandRequest,
  BrowserWorkflowCommandResponse,
} from '@sync-think/protocol';
import {
  parseApproveExecuteBrowserWorkflowPayload,
  parseCreateBrowserWorkflowDraftPayload,
  parseCreateBrowserWorkflowRevisionDraftPayload,
  parseExecuteBrowserWorkflowPayload,
  parseExecuteBrowserWorkflowDraftPayload,
  parseGetBrowserWorkflowPayload,
  parseAssignBrowserWorkflowWorkspacePayload,
  parseListBrowserWorkflowsPayload,
  parseReviewBrowserWorkflowDraftPayload,
  parseSaveBrowserWorkflowDraftPayload,
  parsePublishBrowserWorkflowDraftPayload,
  parseImportChatBrowserWorkflowPayload,
  parseSubmitBrowserWorkflowDraftPayload,
  parseUpdateBrowserWorkflowSchedulePayload,
} from '../browser-workflow-payloads.js';

export interface BrowserWorkflowHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestBrowserWorkflow<K extends BrowserWorkflowCommand>(
    command: K,
    payload: BrowserWorkflowCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<BrowserWorkflowCommandResponse<K>>;
}

export function registerBrowserWorkflowHandlers<Event>(host: BrowserWorkflowHost<Event>): void {
  host.handle('runtime:browser-workflow-assign-workspace', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow('browser.workflow.assignWorkspace', parseAssignBrowserWorkflowWorkspacePayload(value));
  });
  host.handle('runtime:browser-workflow-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.list',
      parseListBrowserWorkflowsPayload(value),
    );
  });

  host.handle('runtime:browser-workflow-get', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.get',
      parseGetBrowserWorkflowPayload(value),
    );
  });

  host.handle('runtime:browser-workflow-create-draft', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.createDraft',
      parseCreateBrowserWorkflowDraftPayload(value),
    );
  });

  host.handle('runtime:browser-workflow-create-revision-draft', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.createRevisionDraft',
      parseCreateBrowserWorkflowRevisionDraftPayload(value),
    );
  });

  host.handle('runtime:browser-workflow-submit', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.submit',
      parseSubmitBrowserWorkflowDraftPayload(value),
    );
  });

  host.handle('runtime:browser-workflow-review', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.review',
      parseReviewBrowserWorkflowDraftPayload(value),
    );
  });

  host.handle('runtime:browser-workflow-save', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.save',
      parseSaveBrowserWorkflowDraftPayload(value),
    );
  });

  host.handle('runtime:browser-workflow-publish', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.publish',
      parsePublishBrowserWorkflowDraftPayload(value),
    );
  });

  host.handle('runtime:browser-workflow-import-chat', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.importChat',
      parseImportChatBrowserWorkflowPayload(value),
    );
  });

  host.handle('runtime:browser-workflow-execute', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.execute',
      parseExecuteBrowserWorkflowPayload(value),
    );
  });

  host.handle('runtime:browser-workflow-execute-draft', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.executeDraft',
      parseExecuteBrowserWorkflowDraftPayload(value),
    );
  });

  host.handle('runtime:browser-workflow-approve-execute', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.approveAndExecute',
      parseApproveExecuteBrowserWorkflowPayload(value),
    );
  });

  host.handle('runtime:browser-workflow-update-schedule', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserWorkflow(
      'browser.workflow.updateSchedule',
      parseUpdateBrowserWorkflowSchedulePayload(value),
    );
  });
}
