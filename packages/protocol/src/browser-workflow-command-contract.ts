import type {
  ApproveExecuteBrowserWorkflowPayload,
  CreateBrowserWorkflowDraftPayload,
  CreateBrowserWorkflowDraftResponse,
  CreateBrowserWorkflowRevisionDraftPayload,
  CreateBrowserWorkflowRevisionDraftResponse,
  ExecuteBrowserWorkflowPayload,
  ExecuteBrowserWorkflowResponse,
  ExecuteBrowserWorkflowDraftPayload,
  GetBrowserWorkflowPayload,
  GetBrowserWorkflowResponse,
  ListBrowserWorkflowsPayload,
  ListBrowserWorkflowsResponse,
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
} from './commands.js';

/** Browser Workflow RPCs bind each command to its request and response payload. */
export interface BrowserWorkflowCommandContract {
  'browser.workflow.assignWorkspace': {
    request: import('./commands.js').AssignBrowserWorkflowWorkspacePayload;
    response: { task: import('./commands.js').BrowserAutomationTaskSummary };
  };
  'browser.workflow.list': {
    request: ListBrowserWorkflowsPayload;
    response: ListBrowserWorkflowsResponse;
  };
  'browser.workflow.get': {
    request: GetBrowserWorkflowPayload;
    response: GetBrowserWorkflowResponse;
  };
  'browser.workflow.createDraft': {
    request: CreateBrowserWorkflowDraftPayload;
    response: CreateBrowserWorkflowDraftResponse;
  };
  'browser.workflow.createRevisionDraft': {
    request: CreateBrowserWorkflowRevisionDraftPayload;
    response: CreateBrowserWorkflowRevisionDraftResponse;
  };
  'browser.workflow.submit': {
    request: SubmitBrowserWorkflowDraftPayload;
    response: SubmitBrowserWorkflowDraftResponse;
  };
  'browser.workflow.save': {
    request: SaveBrowserWorkflowDraftPayload;
    response: SaveBrowserWorkflowDraftResponse;
  };
  'browser.workflow.publish': {
    request: PublishBrowserWorkflowDraftPayload;
    response: PublishBrowserWorkflowDraftResponse;
  };
  'browser.workflow.importChat': {
    request: ImportChatBrowserWorkflowPayload;
    response: ImportChatBrowserWorkflowResponse;
  };
  'browser.workflow.review': {
    request: ReviewBrowserWorkflowDraftPayload;
    response: ReviewBrowserWorkflowDraftResponse;
  };
  'browser.workflow.execute': {
    request: ExecuteBrowserWorkflowPayload;
    response: ExecuteBrowserWorkflowResponse;
  };
  'browser.workflow.executeDraft': {
    request: ExecuteBrowserWorkflowDraftPayload;
    response: ExecuteBrowserWorkflowResponse;
  };
  'browser.workflow.approveAndExecute': {
    request: ApproveExecuteBrowserWorkflowPayload;
    response: ExecuteBrowserWorkflowResponse;
  };
  'browser.workflow.updateSchedule': {
    request: UpdateBrowserWorkflowSchedulePayload;
    response: UpdateBrowserWorkflowScheduleResponse;
  };
}

export type BrowserWorkflowCommand = keyof BrowserWorkflowCommandContract;
export type BrowserWorkflowCommandRequest<K extends BrowserWorkflowCommand> =
  BrowserWorkflowCommandContract[K]['request'];
export type BrowserWorkflowCommandResponse<K extends BrowserWorkflowCommand> =
  BrowserWorkflowCommandContract[K]['response'];
