import type {
  AppendMessagePayload,
  AppendMessageResponse,
  AttachMessageImagesPayload,
  AttachMessageImagesResponse,
  ConversationListMessagesPayload,
  ConversationListMessagesResponse,
  ConversationGetContextStatusPayload,
  ConversationGetContextStatusResponse,
  ConversationSendMessagePayload,
  ConversationSendMessageResponse,
  ConversationCompactPayload,
  ConversationCompactResponse,
  ConversationListNavigationPayload,
  ConversationListNavigationResponse,
  ConversationGetRunProcessResponse,
  ConversationListRunTimelinePayload,
  ConversationListRunTimelineResponse,
  ConversationDecideToolApprovalPayload,
  ConversationDecideToolApprovalResponse,
  ListPendingToolApprovalsPayload,
  ListPendingToolApprovalsResponse,
  ConversationSubmitBrowserResultPayload,
  ConversationSubmitBrowserResultResponse,
  CreateConversationPayload,
  ConversationResponse,
  DeleteConversationPayload,
  ListConversationsPayload,
  ListConversationsResponse,
  RenameConversationPayload,
  SetConversationArchivedPayload,
  SetConversationPinnedPayload,
  SetConversationExecutionModePayload,
  SetConversationInteractionModePayload,
  SetConversationContextWindowOverridePayload,
  UpgradeConversationTrackPayload,
  RebindConversationTargetPayload,
  ConversationPlanSubmitPayload,
  ConversationPlanGetPayload,
  ConversationPlanApprovePayload,
  ConversationPlanRevisePayload,
  ConversationPlanCancelPayload,
  ConversationPlanResponse,
  ConversationPlanApproveResponse,
  ConversationAskAnswerPayload,
  ConversationAskCancelPayload,
  ConversationAskPendingPayload,
  ConversationAskPendingResponse,
} from './commands.js';
import type {
  ConversationReadContentPayload,
  ConversationReadContentResponse,
} from './conversation-content.js';
import type { ConversationGetRunProcessPayload } from './run-process-page.js';
import type {
  ConversationReadFileDiffPayload,
  ConversationReadFileDiffResponse,
} from './conversation-file-diff.js';
import type {
  ConversationListFileChangesPayload,
  ConversationFileChangesPage,
} from './conversation-file-changes.js';
import type { TaskPlanHistoryPayload, TaskPlanHistoryPage } from './task-plan-history.js';

/** Migrated conversation RPCs bind each command to its own request and response. */
export interface ConversationCommandContract {
  'conversation.list': {
    request: ListConversationsPayload;
    response: ListConversationsResponse;
  };
  'conversation.create': {
    request: CreateConversationPayload;
    response: ConversationResponse;
  };
  'conversation.rename': {
    request: RenameConversationPayload;
    response: ConversationResponse;
  };
  'conversation.setPinned': {
    request: SetConversationPinnedPayload;
    response: ConversationResponse;
  };
  'conversation.setArchived': {
    request: SetConversationArchivedPayload;
    response: ConversationResponse;
  };
  'conversation.delete': {
    request: DeleteConversationPayload;
    response: Record<string, never>;
  };
  'conversation.setExecutionMode': {
    request: SetConversationExecutionModePayload;
    response: ConversationResponse;
  };
  'conversation.setInteractionMode': {
    request: SetConversationInteractionModePayload;
    response: ConversationResponse;
  };
  'conversation.setContextWindowOverride': {
    request: SetConversationContextWindowOverridePayload;
    response: ConversationResponse;
  };
  'conversation.upgradeTrack': {
    request: UpgradeConversationTrackPayload;
    response: ConversationResponse;
  };
  'conversation.rebindTarget': {
    request: RebindConversationTargetPayload;
    response: ConversationResponse;
  };
  'conversation.plan.submit': {
    request: ConversationPlanSubmitPayload;
    response: ConversationPlanResponse;
  };
  'conversation.plan.get': {
    request: ConversationPlanGetPayload;
    response: ConversationPlanResponse;
  };
  'conversation.plan.approve': {
    request: ConversationPlanApprovePayload;
    response: ConversationPlanApproveResponse;
  };
  'conversation.plan.revise': {
    request: ConversationPlanRevisePayload;
    response: ConversationPlanResponse;
  };
  'conversation.plan.cancel': {
    request: ConversationPlanCancelPayload;
    response: ConversationPlanResponse;
  };
  'conversation.ask.answer': {
    request: ConversationAskAnswerPayload;
    response: { askId: string };
  };
  'conversation.ask.cancel': {
    request: ConversationAskCancelPayload;
    response: { askId: string };
  };
  'conversation.ask.pending': {
    request: ConversationAskPendingPayload;
    response: ConversationAskPendingResponse;
  };
  'conversation.sendMessage': {
    request: ConversationSendMessagePayload;
    response: ConversationSendMessageResponse;
  };
  'conversation.compact': {
    request: ConversationCompactPayload;
    response: ConversationCompactResponse;
  };
  'conversation.listNavigation': {
    request: ConversationListNavigationPayload;
    response: ConversationListNavigationResponse;
  };
  'conversation.getRunProcess': {
    request: ConversationGetRunProcessPayload;
    response: ConversationGetRunProcessResponse;
  };
  'conversation.listRunTimeline': {
    request: ConversationListRunTimelinePayload;
    response: ConversationListRunTimelineResponse;
  };
  'conversation.readContent': {
    request: ConversationReadContentPayload;
    response: ConversationReadContentResponse;
  };
  'conversation.readFileDiff': {
    request: ConversationReadFileDiffPayload;
    response: ConversationReadFileDiffResponse;
  };
  'conversation.listFileChanges': {
    request: ConversationListFileChangesPayload;
    response: ConversationFileChangesPage;
  };
  'conversation.taskPlanHistory': {
    request: TaskPlanHistoryPayload;
    response: TaskPlanHistoryPage;
  };
  'task.appendMessage': { request: AppendMessagePayload; response: AppendMessageResponse };
  'message.attachImages': {
    request: AttachMessageImagesPayload;
    response: AttachMessageImagesResponse;
  };
  'conversation.listMessages': {
    request: ConversationListMessagesPayload;
    response: ConversationListMessagesResponse;
  };
  'conversation.getContextStatus': {
    request: ConversationGetContextStatusPayload;
    response: ConversationGetContextStatusResponse;
  };
  'conversation.decideToolApproval': {
    request: ConversationDecideToolApprovalPayload;
    response: ConversationDecideToolApprovalResponse;
  };
  'conversation.listPendingToolApprovals': {
    request: ListPendingToolApprovalsPayload;
    response: ListPendingToolApprovalsResponse;
  };
  'conversation.submitBrowserResult': {
    request: ConversationSubmitBrowserResultPayload;
    response: ConversationSubmitBrowserResultResponse;
  };
}
export type ConversationCommand = keyof ConversationCommandContract;
export type ConversationCommandRequest<K extends ConversationCommand> =
  ConversationCommandContract[K]['request'];
export type ConversationCommandResponse<K extends ConversationCommand> =
  ConversationCommandContract[K]['response'];
