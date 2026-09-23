import type {
  ApproveExecuteBrowserWorkflowPayload,
  CreateBrowserWorkflowDraftPayload,
  CreateBrowserWorkflowRevisionDraftPayload,
  ExecuteBrowserWorkflowPayload,
  ExecuteBrowserWorkflowDraftPayload,
  GetBrowserWorkflowPayload,
  ListBrowserWorkflowsPayload,
  ReviewBrowserWorkflowDraftPayload,
  SaveBrowserWorkflowDraftPayload,
  PublishBrowserWorkflowDraftPayload,
  ImportChatBrowserWorkflowPayload,
  SubmitBrowserWorkflowDraftPayload,
  UpdateBrowserWorkflowSchedulePayload,
} from '@sync-think/protocol';
import {
  tryParseApproveExecuteBrowserWorkflowPayload,
  tryParseCreateBrowserWorkflowDraftPayload,
  tryParseCreateBrowserWorkflowRevisionDraftPayload,
  tryParseExecuteBrowserWorkflowPayload,
  tryParseExecuteBrowserWorkflowDraftPayload,
  tryParseGetBrowserWorkflowPayload,
  tryParseAssignBrowserWorkflowWorkspacePayload,
  tryParseListBrowserWorkflowsPayload,
  tryParseReviewBrowserWorkflowDraftPayload,
  tryParseSaveBrowserWorkflowDraftPayload,
  tryParsePublishBrowserWorkflowDraftPayload,
  tryParseImportChatBrowserWorkflowPayload,
  tryParseSubmitBrowserWorkflowDraftPayload,
  tryParseUpdateBrowserWorkflowSchedulePayload,
} from '@sync-think/protocol/browser-payloads';

function requirePayload<T>(command: string, payload: T | undefined): T {
  if (payload === undefined) throw new Error(`Invalid ${command} payload`);
  return payload;
}

export function parseAssignBrowserWorkflowWorkspacePayload(value: unknown): import('@sync-think/protocol').AssignBrowserWorkflowWorkspacePayload {
  return requirePayload('assign-browser-workflow-workspace', tryParseAssignBrowserWorkflowWorkspacePayload(value));
}

export function parseListBrowserWorkflowsPayload(value: unknown): ListBrowserWorkflowsPayload {
  return requirePayload('list-browser-workflows', tryParseListBrowserWorkflowsPayload(value));
}

export function parseGetBrowserWorkflowPayload(value: unknown): GetBrowserWorkflowPayload {
  return requirePayload('get-browser-workflow', tryParseGetBrowserWorkflowPayload(value));
}

export function parseCreateBrowserWorkflowDraftPayload(
  value: unknown,
): CreateBrowserWorkflowDraftPayload {
  return requirePayload(
    'create-browser-workflow-draft',
    tryParseCreateBrowserWorkflowDraftPayload(value),
  );
}

export function parseCreateBrowserWorkflowRevisionDraftPayload(
  value: unknown,
): CreateBrowserWorkflowRevisionDraftPayload {
  return requirePayload(
    'create-browser-workflow-revision-draft',
    tryParseCreateBrowserWorkflowRevisionDraftPayload(value),
  );
}

export function parseSubmitBrowserWorkflowDraftPayload(
  value: unknown,
): SubmitBrowserWorkflowDraftPayload {
  return requirePayload(
    'submit-browser-workflow-draft',
    tryParseSubmitBrowserWorkflowDraftPayload(value),
  );
}

export function parseReviewBrowserWorkflowDraftPayload(
  value: unknown,
): ReviewBrowserWorkflowDraftPayload {
  return requirePayload(
    'review-browser-workflow-draft',
    tryParseReviewBrowserWorkflowDraftPayload(value),
  );
}

export function parseSaveBrowserWorkflowDraftPayload(
  value: unknown,
): SaveBrowserWorkflowDraftPayload {
  return requirePayload(
    'save-browser-workflow-draft',
    tryParseSaveBrowserWorkflowDraftPayload(value),
  );
}

export function parsePublishBrowserWorkflowDraftPayload(
  value: unknown,
): PublishBrowserWorkflowDraftPayload {
  return requirePayload(
    'publish-browser-workflow-draft',
    tryParsePublishBrowserWorkflowDraftPayload(value),
  );
}

export function parseImportChatBrowserWorkflowPayload(
  value: unknown,
): ImportChatBrowserWorkflowPayload {
  return requirePayload(
    'import-chat-browser-workflow',
    tryParseImportChatBrowserWorkflowPayload(value),
  );
}

export function parseExecuteBrowserWorkflowPayload(value: unknown): ExecuteBrowserWorkflowPayload {
  return requirePayload('execute-browser-workflow', tryParseExecuteBrowserWorkflowPayload(value));
}

export function parseExecuteBrowserWorkflowDraftPayload(
  value: unknown,
): ExecuteBrowserWorkflowDraftPayload {
  return requirePayload(
    'execute-browser-workflow-draft',
    tryParseExecuteBrowserWorkflowDraftPayload(value),
  );
}

export function parseApproveExecuteBrowserWorkflowPayload(
  value: unknown,
): ApproveExecuteBrowserWorkflowPayload {
  return requirePayload(
    'approve-execute-browser-workflow',
    tryParseApproveExecuteBrowserWorkflowPayload(value),
  );
}

export function parseUpdateBrowserWorkflowSchedulePayload(
  value: unknown,
): UpdateBrowserWorkflowSchedulePayload {
  return requirePayload(
    'update-browser-workflow-schedule',
    tryParseUpdateBrowserWorkflowSchedulePayload(value),
  );
}
