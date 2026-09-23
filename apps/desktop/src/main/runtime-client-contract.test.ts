import { expectTypeOf, it } from 'vitest';
import { WEB_SEARCH_PROVIDER_IDS } from '@sync-think/protocol';
import type {
  AppendMessageResponse,
  AttachMessageImagesResponse,
  ConversationListMessagesResponse,
} from '@sync-think/protocol';
import type { RuntimePipeClient } from './runtime-client.js';

// Type-checked, never connects to the user's Runtime.
function assertCommandContracts(client: RuntimePipeClient) {
  const append = client.requestConversation('task.appendMessage', {
    threadId: 'thread' as import('@sync-think/shared').ThreadId,
    text: 'hello',
    role: 'user',
    expectedTaskVersion: 0,
  });
  expectTypeOf(append).toEqualTypeOf<Promise<AppendMessageResponse>>();
  expectTypeOf(
    client.requestConversation('message.attachImages', {
      threadId: 'thread' as import('@sync-think/shared').ThreadId,
      messageId: 'message' as import('@sync-think/shared').MessageId,
      images: [{
        id: 'image-1',
        name: 'screen.png',
        mimeType: 'image/png',
        storageRef: 'image-1.png',
      }],
    }),
  ).toEqualTypeOf<Promise<AttachMessageImagesResponse>>();
  const messages = client.requestConversation('conversation.listMessages', {
    conversationId: 'conversation' as import('@sync-think/shared').ConversationId,
  });
  expectTypeOf(messages).toEqualTypeOf<Promise<ConversationListMessagesResponse>>();
  const conversationId = 'conversation' as import('@sync-think/shared').ConversationId;
  const runId = 'run' as import('@sync-think/shared').RunId;
  expectTypeOf(client.requestConversation('conversation.list', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListConversationsResponse>
  >();
  expectTypeOf(
    client.requestConversation('conversation.create', {
      track: 'model',
      targetRef: 'model-1',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.rename', { conversationId, title: 'Renamed' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.setPinned', { conversationId, pinned: true }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.setArchived', { conversationId, archived: true }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationResponse>>();
  expectTypeOf(client.requestConversation('conversation.delete', { conversationId })).toEqualTypeOf<
    Promise<Record<string, never>>
  >();
  expectTypeOf(
    client.requestConversation('conversation.setExecutionMode', {
      conversationId,
      executionMode: 'full-access',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.setInteractionMode', {
      conversationId,
      interactionMode: 'plan',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.setContextWindowOverride', {
      conversationId,
      contextWindowOverride: 32_768,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.upgradeTrack', {
      conversationId,
      track: 'agent',
      targetRef: 'agent-1',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.rebindTarget', {
      conversationId,
      track: 'model',
      targetRef: 'model-1',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationResponse>>();
  const plan: import('@sync-think/shared').ChatPlanSubmission = {
    title: 'Implementation plan',
    goal: 'Ship the change',
    scope: [],
    assumptions: [],
    decisions: [],
    steps: [],
    risks: [],
    finalAcceptanceChecks: [],
  };
  expectTypeOf(
    client.requestConversation('conversation.plan.submit', { conversationId, plan }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationPlanResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.plan.get', { conversationId }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationPlanResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.plan.approve', { conversationId, revision: 1 }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationPlanApproveResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.plan.revise', {
      conversationId,
      expectedRevision: 1,
      plan,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationPlanResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.plan.cancel', { conversationId }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationPlanResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.ask.answer', {
      askId: 'ask-1',
      answers: [{ id: 'question-1', selected: ['Proceed'] }],
    }),
  ).toEqualTypeOf<Promise<{ askId: string }>>();
  expectTypeOf(
    client.requestConversation('conversation.ask.cancel', { askId: 'ask-1' }),
  ).toEqualTypeOf<Promise<{ askId: string }>>();
  expectTypeOf(
    client.requestConversation('conversation.ask.pending', { threadId: 'thread-1' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationAskPendingResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.sendMessage', { conversationId, text: '' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationSendMessageResponse>>();
  expectTypeOf(
    client.requestConversation(
      'conversation.compact',
      { conversationId, mode: 'auto' },
      { timeoutMs: 120_000 },
    ),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationCompactResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.getContextStatus', { conversationId }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationGetContextStatusResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.listNavigation', { conversationId }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationListNavigationResponse>>();
  expectTypeOf(client.requestConversation('conversation.getRunProcess', { runId })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ConversationGetRunProcessResponse>
  >();
  expectTypeOf(client.requestConversation('conversation.listRunTimeline', { runId })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ConversationListRunTimelineResponse>
  >();
  expectTypeOf(
    client.requestConversation('conversation.readContent', {
      conversationId,
      reference: { source: 'event', id: 'event', path: ['result'] },
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationReadContentResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.readFileDiff', {
      conversationId,
      before: { text: '' },
      after: { text: 'new' },
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationReadFileDiffResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.listFileChanges', { conversationId, offset: 0 }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationFileChangesPage>>();
  expectTypeOf(
    client.requestConversation('conversation.taskPlanHistory', { conversationId, offset: 0 }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').TaskPlanHistoryPage>>();
  expectTypeOf(
    client.requestConversation('conversation.decideToolApproval', {
      approvalId: 'approval-1',
      decision: 'approve',
      scope: 'session',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConversationDecideToolApprovalResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.listPendingToolApprovals', {
      threadId: 'thread' as import('@sync-think/shared').ThreadId,
      runId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ListPendingToolApprovalsResponse>>();
  expectTypeOf(
    client.requestConversation('conversation.submitBrowserResult', {
      requestId: 'request-1',
      ok: true,
      resultJson: '{}',
    }),
  ).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ConversationSubmitBrowserResultResponse>
  >();
  // @ts-expect-error Preparing a message requires text, unlike read queries.
  client.requestConversation('conversation.sendMessage', { conversationId });
  // @ts-expect-error Context compaction has a closed mode contract.
  client.requestConversation('conversation.compact', { conversationId, mode: 'invalid' });
  // @ts-expect-error Content references are mandatory and must not be replaced by file paths.
  client.requestConversation('conversation.readContent', { conversationId, path: 'local-file' });
  // @ts-expect-error Timeline reads are run-scoped, not conversation-scoped.
  client.requestConversation('conversation.listRunTimeline', { conversationId });
  // @ts-expect-error A message-list payload is not an append payload.
  client.requestConversation('task.appendMessage', { conversationId: 'conversation' });
  // @ts-expect-error Durable image attachment requires message identity and image references.
  client.requestConversation('message.attachImages', { threadId: 'thread' });
  client.requestConversation('conversation.decideToolApproval', {
    approvalId: 'approval-1',
    // @ts-expect-error Approval decisions have a closed decision vocabulary.
    decision: 'skip',
  });
  // @ts-expect-error Pending approval reads are thread-scoped.
  client.requestConversation('conversation.listPendingToolApprovals', { runId });
  // @ts-expect-error Browser replies require an explicit success flag.
  client.requestConversation('conversation.submitBrowserResult', { requestId: 'request-1' });
  // @ts-expect-error Conversation creation requires a target reference.
  client.requestConversation('conversation.create', { track: 'model' });
  // @ts-expect-error Pin writes require an explicit boolean state.
  client.requestConversation('conversation.setPinned', { conversationId });
  client.requestConversation('conversation.setInteractionMode', {
    conversationId,
    // @ts-expect-error Interaction modes use a closed vocabulary.
    interactionMode: 'chat',
  });
  client.requestConversation('conversation.upgradeTrack', {
    conversationId,
    // @ts-expect-error Track upgrades cannot downgrade to the model track.
    track: 'model',
    targetRef: 'model-1',
  });
  // @ts-expect-error Plan submissions require plan content.
  client.requestConversation('conversation.plan.submit', { conversationId });
  // @ts-expect-error Plan approval requires a revision.
  client.requestConversation('conversation.plan.approve', { conversationId });
  // @ts-expect-error Ask answers require at least the answer collection field.
  client.requestConversation('conversation.ask.answer', { askId: 'ask-1' });
  // @ts-expect-error Pending Ask reads are thread-scoped.
  client.requestConversation('conversation.ask.pending', { conversationId });
  // @ts-expect-error Unknown commands must use a separately declared contract.
  client.requestConversation('unknown.command', {});
}

function assertBrowserProfileCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestBrowserProfile('browser.profile.list', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListBrowserProfilesResponse>
  >();
  expectTypeOf(
    client.requestBrowserProfile('browser.profile.create', { name: 'Work' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CreateBrowserProfileResponse>>();
  expectTypeOf(
    client.requestBrowserProfile('browser.profile.rename', {
      profileId: 'profile-1',
      name: 'Personal',
      expectedRevision: 2,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').RenameBrowserProfileResponse>>();
  expectTypeOf(
    client.requestBrowserProfile('browser.profile.delete', {
      profileId: 'profile-1',
      expectedRevision: 2,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DeleteBrowserProfileResponse>>();
  expectTypeOf(
    client.requestBrowserProfile('browser.profile.listSiteSessions', {
      profileId: 'profile-1',
      refresh: true,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ListBrowserSiteSessionsResponse>>();
  expectTypeOf(
    client.requestBrowserProfile('browser.profile.clearSiteSession', {
      profileId: 'profile-1',
      siteKey: 'example.com',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ClearBrowserSiteSessionResponse>>();
  // @ts-expect-error Profile creation requires a name.
  client.requestBrowserProfile('browser.profile.create', {});
  // @ts-expect-error Rename requests require optimistic-concurrency revision data.
  client.requestBrowserProfile('browser.profile.rename', {
    profileId: 'profile-1',
    name: 'Work',
  });
  // @ts-expect-error Site-session commands are profile-scoped.
  client.requestBrowserProfile('browser.profile.listSiteSessions', { refresh: true });
  // @ts-expect-error Recording commands belong to a separate contract.
  client.requestBrowserProfile('browser.recording.list', {});
}

function assertBrowserRecordingCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestBrowserRecording('browser.recording.list', {
      profileId: 'profile-1',
      limit: 20,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ListBrowserRecordingsResponse>>();
  expectTypeOf(
    client.requestBrowserRecording('browser.recording.get', {
      recordingId: 'recording-1',
      afterSequence: 0,
      limit: 100,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').GetBrowserRecordingResponse>>();
  expectTypeOf(
    client.requestBrowserRecording('browser.recording.start', {
      profileId: 'profile-1',
      expectedProfileRevision: 3,
      startUrl: 'https://example.test',
      draftId: 'draft-1',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').StartBrowserRecordingResponse>>();
  expectTypeOf(
    client.requestBrowserRecording('browser.recording.stop', {
      recordingId: 'recording-1',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').StopBrowserRecordingResponse>>();
  // @ts-expect-error Recording lists are profile-scoped.
  client.requestBrowserRecording('browser.recording.list', {});
  // @ts-expect-error Starting requires optimistic Profile revision data.
  client.requestBrowserRecording('browser.recording.start', { profileId: 'profile-1' });
  // @ts-expect-error Stop requires a recording ID.
  client.requestBrowserRecording('browser.recording.stop', {});
  // @ts-expect-error Workflow commands belong to a separate contract.
  client.requestBrowserRecording('browser.workflow.list', {});
}

function assertBrowserWorkflowCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestBrowserWorkflow('browser.workflow.list', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListBrowserWorkflowsResponse>
  >();
  expectTypeOf(
    client.requestBrowserWorkflow('browser.workflow.get', { taskId: 'task-1' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').GetBrowserWorkflowResponse>>();
  expectTypeOf(
    client.requestBrowserWorkflow('browser.workflow.createDraft', {
      profileId: 'profile-1',
      name: 'Checkout',
      instruction: 'Complete checkout',
      startUrl: 'https://example.test/cart',
      source: 'manual',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CreateBrowserWorkflowDraftResponse>>();
  expectTypeOf(
    client.requestBrowserWorkflow('browser.workflow.createRevisionDraft', {
      taskId: 'task-1',
      expectedTaskRevision: 2,
    }),
  ).toEqualTypeOf<
    Promise<import('@sync-think/protocol').CreateBrowserWorkflowRevisionDraftResponse>
  >();
  expectTypeOf(
    client.requestBrowserWorkflow('browser.workflow.submit', {
      draftId: 'draft-1',
      recordingId: 'recording-1',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SubmitBrowserWorkflowDraftResponse>>();
  expectTypeOf(
    client.requestBrowserWorkflow('browser.workflow.review', {
      draftId: 'draft-1',
      decision: 'approve',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ReviewBrowserWorkflowDraftResponse>>();
  expectTypeOf(
    client.requestBrowserWorkflow('browser.workflow.execute', { taskId: 'task-1' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ExecuteBrowserWorkflowResponse>>();
  expectTypeOf(
    client.requestBrowserWorkflow('browser.workflow.approveAndExecute', {
      taskId: 'task-1',
      origins: ['https://example.test'],
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ExecuteBrowserWorkflowResponse>>();
  // @ts-expect-error Workflow detail reads require a task ID.
  client.requestBrowserWorkflow('browser.workflow.get', {});
  // @ts-expect-error Revision drafts require optimistic-concurrency revision data.
  client.requestBrowserWorkflow('browser.workflow.createRevisionDraft', { taskId: 'task-1' });
  // @ts-expect-error Approval and execution requires explicit origins.
  client.requestBrowserWorkflow('browser.workflow.approveAndExecute', { taskId: 'task-1' });
  // @ts-expect-error Recording commands belong to a separate contract.
  client.requestBrowserWorkflow('browser.recording.list', { profileId: 'profile-1' });
}

function assertBrowserHandoffCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestBrowserHandoff('browser.handoff.listWaiting', {
      workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
      runId: 'run-1' as import('@sync-think/shared').RunId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ListWaitingBrowserHandoffsResponse>>();
  expectTypeOf(
    client.requestBrowserHandoff('browser.handoff.continue', {
      handoffId: 'handoff-1',
      expectedRevision: 1,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ContinueBrowserHandoffResponse>>();
  expectTypeOf(
    client.requestBrowserHandoff('browser.handoff.cancel', {
      handoffId: 'handoff-1',
      expectedRevision: 1,
      leaseDisposition: 'release',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CancelBrowserHandoffResponse>>();
  // @ts-expect-error Continuing requires the durable Handoff revision.
  client.requestBrowserHandoff('browser.handoff.continue', { handoffId: 'handoff-1' });
  client.requestBrowserHandoff('browser.handoff.cancel', {
    handoffId: 'handoff-1',
    expectedRevision: 1,
    // @ts-expect-error Lease disposition has a closed vocabulary.
    leaseDisposition: 'close',
  });
  // @ts-expect-error Workflow commands belong to a separate contract.
  client.requestBrowserHandoff('browser.workflow.list', {});
}

function assertDesktopCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestDesktopCommand('desktop.command.listWaiting', {
      workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
      runId: 'run-1' as import('@sync-think/shared').RunId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ListWaitingDesktopCommandsResponse>>();
  expectTypeOf(
    client.requestDesktopCommand('desktop.command.continue', {
      commandId: 'command-1',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ContinueDesktopCommandResponse>>();
  expectTypeOf(
    client.requestDesktopCommand('desktop.command.cancel', {
      commandId: 'command-1',
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CancelDesktopCommandResponse>>();
  // @ts-expect-error Continuing requires an updated-at concurrency fence.
  client.requestDesktopCommand('desktop.command.continue', { commandId: 'command-1' });
  // @ts-expect-error Cancellation is command-scoped, not Run-scoped.
  client.requestDesktopCommand('desktop.command.cancel', { runId: 'run-1' });
  // @ts-expect-error Browser Handoff commands belong to a separate contract.
  client.requestDesktopCommand('browser.handoff.listWaiting', {});
}

function assertBrowserExtensionCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestBrowserExtension('browser.extension.status', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').BrowserExtensionStatus>
  >();
  expectTypeOf(client.requestBrowserExtension('browser.extension.restart', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').BrowserExtensionStatus>
  >();
  expectTypeOf(client.requestBrowserExtension('browser.extension.resetPairing', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').BrowserExtensionStatus>
  >();
  expectTypeOf(client.requestBrowserExtension('browser.extension.openFolder', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').BrowserExtensionOpenFolderResult>
  >();
  // @ts-expect-error Browser Extension commands have no request fields.
  client.requestBrowserExtension('browser.extension.status', { refresh: true });
  // @ts-expect-error Browser Handoff commands belong to a separate contract.
  client.requestBrowserExtension('browser.handoff.listWaiting', {});
}

function assertApprovalCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestApproval('approval.list', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListApprovalsResponse>
  >();
  expectTypeOf(
    client.requestApproval('approval.evaluate', { action: 'delete file' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').EvaluateApprovalResponse>>();
  expectTypeOf(client.requestApproval('approval.enqueue', { action: 'publish' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').EnqueueApprovalResponse>
  >();
  expectTypeOf(
    client.requestApproval('approval.decide', {
      id: 'approval-1' as import('@sync-think/shared').ApprovalRequestId,
      decision: 'approved',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DecideApprovalResponse>>();
  // @ts-expect-error Evaluation requires an action.
  client.requestApproval('approval.evaluate', {});
  // @ts-expect-error Approval decisions require an ID and decision.
  client.requestApproval('approval.decide', { id: 'approval-1' });
  // @ts-expect-error Browser Extension commands belong to a separate contract.
  client.requestApproval('browser.extension.status', {});
}

function assertMemoryCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestMemory('memory.list', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListMemoryResponse>
  >();
  expectTypeOf(
    client.requestMemory('memory.decide', {
      changeId: 'change-1' as import('@sync-think/shared').MemoryChangeId,
      decision: 'approved',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DecideMemoryResponse>>();
  expectTypeOf(
    client.requestMemory('memory.rollback', {
      changeId: 'change-1' as import('@sync-think/shared').MemoryChangeId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').RollbackMemoryResponse>>();
  // @ts-expect-error Memory decisions require a change ID.
  client.requestMemory('memory.decide', { decision: 'approved' });
  // @ts-expect-error Approval commands belong to a separate contract.
  client.requestMemory('approval.list', {});
}

function assertContextPacketCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestContextPacket('context.packet.peek', {
      threadId: 'thread-1' as import('@sync-think/shared').ThreadId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').PeekContextPacketResponse>>();
  expectTypeOf(
    client.requestContextPacket('context.packet.amend', {
      threadId: 'thread-1' as import('@sync-think/shared').ThreadId,
      excludeSourceIds: ['source-1'],
      clearAll: false,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').AmendContextPacketResponse>>();
  // @ts-expect-error Context Packet peek requires a thread ID.
  client.requestContextPacket('context.packet.peek', {});
  // @ts-expect-error Memory commands belong to a separate contract.
  client.requestContextPacket('memory.list', {});
}

function assertDiagnosticsCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestDiagnostics('diagnostics.list', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListDiagnosticsResponse>
  >();
  expectTypeOf(client.requestDiagnostics('diagnostics.list', { limit: 200 })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListDiagnosticsResponse>
  >();
  // @ts-expect-error Diagnostics lists do not accept Memory filters.
  client.requestDiagnostics('diagnostics.list', { approvalState: 'pending' });
  // @ts-expect-error Context Packet commands belong to a separate contract.
  client.requestDiagnostics('context.packet.peek', {});
}

function assertGatewayCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestGateway('gateway.status', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').OpenGatewayStatusResponse>
  >();
  expectTypeOf(
    client.requestGateway('gateway.logs', {
      offset: 0,
      limit: 20,
      filter: { status: 'error', converted: true },
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').GatewayLogsResponse>>();
  expectTypeOf(client.requestGateway('gateway.logs.clear', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').GatewayLogsClearResponse>
  >();
  // @ts-expect-error Gateway log status has a closed vocabulary.
  client.requestGateway('gateway.logs', { filter: { status: 'pending' } });
  // @ts-expect-error Diagnostics commands belong to a separate contract.
  client.requestGateway('diagnostics.list', {});
}

function assertKernelCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestKernel('kernel.detect', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').KernelDetectResponse>
  >();
  expectTypeOf(client.requestKernel('kernel.recycle', { kernelId: 'codex' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').KernelRecycleResponse>
  >();
  // @ts-expect-error Kernel detection has no request fields.
  client.requestKernel('kernel.detect', { refresh: true });
  // @ts-expect-error Pi does not have a resident Runtime session to recycle.
  client.requestKernel('kernel.recycle', { kernelId: 'pi' });
  // @ts-expect-error Gateway commands belong to a separate contract.
  client.requestKernel('gateway.status', {});
}

function assertSettingsCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestSettings('settings.get', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').GetSettingsResponse>
  >();
  expectTypeOf(client.requestSettings('settings.get', { keys: ['appearance'] })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').GetSettingsResponse>
  >();
  expectTypeOf(
    client.requestSettings('settings.set', { key: 'appearance', value: { theme: 'dark' } }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SetSettingResponse>>();
  // @ts-expect-error Settings reads accept only an optional list of keys.
  client.requestSettings('settings.get', { key: 'appearance' });
  // @ts-expect-error Settings writes require an explicit value.
  client.requestSettings('settings.set', { key: 'appearance' });
  // @ts-expect-error Kernel commands belong to a separate contract.
  client.requestSettings('kernel.detect', {});
}

function assertPolicyCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestPolicy('policy.save', {
      workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
      scopeType: 'task',
      scopeId: 'task-1',
      approvalMode: 'request',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SavePolicyResponse>>();
  expectTypeOf(
    client.requestPolicy('policy.list', {
      workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ListPoliciesResponse>>();
  client.requestPolicy('policy.save', {
    workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
    scopeType: 'task',
    scopeId: 'task-1',
    // @ts-expect-error Policy approval mode has a closed vocabulary.
    approvalMode: 'sometimes',
  });
  // @ts-expect-error Policy lists are workspace-scoped.
  client.requestPolicy('policy.list', {});
  // @ts-expect-error Settings commands belong to a separate contract.
  client.requestPolicy('settings.get', {});
}

function assertUsageCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestUsage('usage.summary', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').UsageSummaryResponse>
  >();
  expectTypeOf(
    client.requestUsage('usage.summary', { sinceDays: 30, taskId: 'task-1' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').UsageSummaryResponse>>();
  // @ts-expect-error Usage summaries accept only supported filters.
  client.requestUsage('usage.summary', { providerId: 'provider-1' });
  // @ts-expect-error Policy commands belong to a separate contract.
  client.requestUsage('policy.list', {});
}

function assertAgentCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestAgent('agent.get', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').GetAgentResponse>
  >();
  expectTypeOf(client.requestAgent('agent.list', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListAgentsResponse>
  >();
  expectTypeOf(
    client.requestAgent('agent.updateBinding', {
      defaultModelId: 'model-1' as import('@sync-think/shared').ModelId,
      fallbackModelIds: [],
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').UpdateAgentBindingResponse>>();
  expectTypeOf(
    client.requestAgent('agent.create', {
      name: 'Reviewer',
      role: 'reviewer',
      developerInstructions: 'Review changes',
      inputContract: 'diff',
      outputContract: 'findings',
      defaultModelId: 'model-1' as import('@sync-think/shared').ModelId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CreateAgentResponse>>();
  expectTypeOf(
    client.requestAgent('agent.listVersions', {
      agentId: 'agent-1' as import('@sync-think/shared').AgentId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ListAgentVersionsResponse>>();
  expectTypeOf(
    client.requestAgent('agent.createVersion', {
      agentId: 'agent-1' as import('@sync-think/shared').AgentId,
      expectedVersion: 1,
      name: 'Reviewer',
      role: 'reviewer',
      developerInstructions: 'Review changes',
      inputContract: 'diff',
      outputContract: 'findings',
      defaultModelId: 'model-1' as import('@sync-think/shared').ModelId,
      pauseOnFailure: true,
      fallbackModelIds: [],
      memoryScope: 'task',
      skillVersionIds: [],
      mcpServerIds: [],
      approvalMode: 'request',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CreateAgentVersionResponse>>();
  // @ts-expect-error Agent binding updates require a default model.
  client.requestAgent('agent.updateBinding', { fallbackModelIds: [] });
  // @ts-expect-error Agent lists currently accept no filters.
  client.requestAgent('agent.list', { role: 'worker' });
  // @ts-expect-error Agent creation requires the core definition fields.
  client.requestAgent('agent.create', { name: 'Incomplete' });
  // @ts-expect-error Version lists require an Agent ID.
  client.requestAgent('agent.listVersions', {});
  // @ts-expect-error Version writes require an optimistic-concurrency version.
  client.requestAgent('agent.createVersion', {
    agentId: 'agent-1' as import('@sync-think/shared').AgentId,
    name: 'Reviewer',
    role: 'reviewer',
    developerInstructions: 'Review changes',
    inputContract: 'diff',
    outputContract: 'findings',
    defaultModelId: 'model-1' as import('@sync-think/shared').ModelId,
    pauseOnFailure: true,
    fallbackModelIds: [],
    memoryScope: 'task',
    skillVersionIds: [],
    mcpServerIds: [],
    approvalMode: 'request',
  });
  // @ts-expect-error Usage commands belong to a separate contract.
  client.requestAgent('usage.summary', {});
}

function assertGlobalAgentCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestGlobalAgent('globalAgent.list', { includeArchived: true }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ListGlobalAgentsResponse>>();
  expectTypeOf(
    client.requestGlobalAgent('globalAgent.create', {
      name: 'Reviewer',
      defaultModelId: 'model-1' as import('@sync-think/shared').ModelId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').GlobalAgentResponse>>();
  expectTypeOf(
    client.requestGlobalAgent('globalAgent.update', {
      agentId: 'agent-1' as import('@sync-think/shared').AgentId,
      archived: true,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').GlobalAgentResponse>>();
  expectTypeOf(
    client.requestGlobalAgent('globalAgent.delete', {
      agentId: 'agent-1' as import('@sync-think/shared').AgentId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DeleteGlobalAgentResponse>>();
  expectTypeOf(
    client.requestGlobalAgent('globalAgent.listWorkspaceActivations', {
      workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
    }),
  ).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListGlobalAgentWorkspaceActivationsResponse>
  >();
  expectTypeOf(
    client.requestGlobalAgent('globalAgent.setWorkspaceActivation', {
      agentId: 'agent-1' as import('@sync-think/shared').AgentId,
      workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
      active: true,
    }),
  ).toEqualTypeOf<
    Promise<import('@sync-think/protocol').SetGlobalAgentWorkspaceActivationResponse>
  >();
  // @ts-expect-error Archived filters must be boolean.
  client.requestGlobalAgent('globalAgent.list', { includeArchived: 'yes' });
  // @ts-expect-error Global Agent creation requires a default model.
  client.requestGlobalAgent('globalAgent.create', { name: 'Incomplete' });
  // @ts-expect-error Workspace activation writes require an active flag.
  client.requestGlobalAgent('globalAgent.setWorkspaceActivation', {
    agentId: 'agent-1' as import('@sync-think/shared').AgentId,
    workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
  });
  // @ts-expect-error Team commands belong to a separate contract.
  client.requestGlobalAgent('team.list', {});
}

function assertTeamCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestTeam('team.list', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListTeamsResponse>
  >();
  expectTypeOf(
    client.requestTeam('team.create', {
      name: 'Review Team',
      strategy: 'parallel',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').TeamResponse>>();
  expectTypeOf(
    client.requestTeam('team.update', {
      teamId: 'team-1' as import('@sync-think/shared').TeamId,
      mission: 'Review changes',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').TeamResponse>>();
  expectTypeOf(
    client.requestTeam('team.delete', {
      teamId: 'team-1' as import('@sync-think/shared').TeamId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').TeamEmptyPayload>>();
  expectTypeOf(
    client.requestTeam('team.startRun', {
      teamId: 'team-1' as import('@sync-think/shared').TeamId,
      conversationId: 'conversation-1' as import('@sync-think/shared').ConversationId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').TeamRunResponse>>();
  expectTypeOf(
    client.requestTeam('team.setRunStatus', {
      runId: 'run-1',
      status: 'completed',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').TeamRunResponse>>();
  // @ts-expect-error Team creation requires a name.
  client.requestTeam('team.create', { strategy: 'parallel' });
  // @ts-expect-error Team updates require a Team ID.
  client.requestTeam('team.update', { mission: 'Incomplete' });
  // @ts-expect-error Team run states are constrained.
  client.requestTeam('team.setRunStatus', { runId: 'run-1', status: 'paused' });
  // @ts-expect-error Conversation commands belong to a separate contract.
  client.requestTeam('conversation.list', {});
}

function assertScheduledTaskCommandContracts(client: RuntimePipeClient) {
  const target: import('@sync-think/shared').ScheduledTaskTarget = {
    kind: 'agent',
    agentId: 'agent-1' as import('@sync-think/shared').AgentId,
  };
  const rule: import('@sync-think/shared').TaskRule = { kind: 'every', intervalMinutes: 5 };
  expectTypeOf(
    client.requestScheduledTask('scheduledTask.create', {
      name: 'Daily review',
      instruction: 'Review changes',
      target,
      rule,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CreateScheduledTaskResponse>>();
  expectTypeOf(
    client.requestScheduledTask('scheduledTask.list', { includeDisabled: true }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ListScheduledTasksResponse>>();
  expectTypeOf(
    client.requestScheduledTask('scheduledTask.update', {
      taskId: 'task-1',
      patch: { enabled: false },
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').UpdateScheduledTaskResponse>>();
  expectTypeOf(
    client.requestScheduledTask('scheduledTask.delete', { taskId: 'task-1' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DeleteScheduledTaskResponse>>();
  expectTypeOf(
    client.requestScheduledTask('scheduledTask.trigger', { taskId: 'task-1' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').TriggerScheduledTaskResponse>>();
  expectTypeOf(
    client.requestScheduledTask('scheduledTask.history', { taskId: 'task-1', limit: 20 }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ListScheduledTaskHistoryResponse>>();
  // @ts-expect-error Scheduled Task creation requires its target and rule.
  client.requestScheduledTask('scheduledTask.create', {
    name: 'Incomplete',
    instruction: 'Review changes',
  });
  // @ts-expect-error Scheduled Task updates require a task ID.
  client.requestScheduledTask('scheduledTask.update', { patch: { enabled: false } });
  // @ts-expect-error Scheduled Task history is task-scoped.
  client.requestScheduledTask('scheduledTask.history', {});
  // @ts-expect-error Team commands belong to a separate contract.
  client.requestScheduledTask('team.list', {});
}

function assertActivityCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestActivity('activity.listRuns', {
      workspaceId: 'workspace-1',
      states: ['running', 'failed'],
      sources: ['chat'],
      limit: 20,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ActivityListRunsResponse>>();
  expectTypeOf(
    client.requestActivity('activity.listExternalEvents', {
      workspaceId: 'workspace-1',
      states: ['pending'],
      limit: 20,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ActivityListExternalEventsResponse>>();
  expectTypeOf(client.requestActivity('activity.retryAnchor', { runId: 'run-1' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ActivityRetryAnchorResponse>
  >();
  client.requestActivity('activity.listRuns', {
    // @ts-expect-error Activity run states use a closed vocabulary.
    states: ['waiting'],
  });
  // @ts-expect-error Retry anchors require a run ID.
  client.requestActivity('activity.retryAnchor', {});
  // @ts-expect-error Scheduled Task commands belong to a separate contract.
  client.requestActivity('scheduledTask.list', {});
}

function assertGoalCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestGoal('goal.set', {
      conversationId: 'conversation-1',
      condition: 'Ship the feature',
      maxGoalRounds: 5,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').GoalSetResponse>>();
  expectTypeOf(client.requestGoal('goal.get', { conversationId: 'conversation-1' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').GoalGetResponse>
  >();
  expectTypeOf(
    client.requestGoal('goal.clear', { conversationId: 'conversation-1' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').GoalClearResponse>>();
  expectTypeOf(
    client.requestGoal('goal.pause', { conversationId: 'conversation-1' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').GoalPauseResponse>>();
  expectTypeOf(
    client.requestGoal('goal.resume', {
      conversationId: 'conversation-1',
      networkEnabled: true,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').GoalResumeResponse>>();
  // @ts-expect-error Goal creation requires a completion condition.
  client.requestGoal('goal.set', { conversationId: 'conversation-1' });
  // @ts-expect-error Goal reads require a conversation ID.
  client.requestGoal('goal.get', {});
  // @ts-expect-error Activity commands belong to a separate contract.
  client.requestGoal('activity.listRuns', {});
}

function assertSkillLocalCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestSkillLocal('skill.local.scan', { refresh: true })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').SkillLocalScanResponse>
  >();
  expectTypeOf(
    client.requestSkillLocal('skill.local.inspect', { path: 'C:\\skills\\reviewer' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SkillLocalInspectResponse>>();
  expectTypeOf(
    client.requestSkillLocal('skill.local.import', {
      path: 'C:\\skills\\reviewer.zip',
      scope: { type: 'workspace', workspaceId: 'workspace-1' },
      overwrite: true,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SkillLocalImportResponse>>();
  // @ts-expect-error Local Skill inspection requires a path.
  client.requestSkillLocal('skill.local.inspect', {});
  client.requestSkillLocal('skill.local.import', {
    path: 'C:\\skills\\reviewer.zip',
    // @ts-expect-error Workspace imports require a workspace ID.
    scope: { type: 'workspace' },
  });
  // @ts-expect-error Goal commands belong to a separate contract.
  client.requestSkillLocal('goal.get', { conversationId: 'conversation-1' });
}

function assertSkillMarketCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestSkillMarket('skill.market.list', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListSkillMarketResponse>
  >();
  expectTypeOf(
    client.requestSkillMarket('skill.market.install', { marketSkillId: 'project-bootstrap' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').InstallSkillMarketResponse>>();
  // @ts-expect-error Market installs require a package ID.
  client.requestSkillMarket('skill.market.install', {});
  // @ts-expect-error Market listing has no filters.
  client.requestSkillMarket('skill.market.list', { category: 'development' });
  // @ts-expect-error Local Skill commands belong to a separate contract.
  client.requestSkillMarket('skill.local.scan', {});
}

function assertSkillCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestSkill('skill.import', { skillMd: '---\nname: reviewer\n---\nReview.' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ImportSkillResponse>>();
  expectTypeOf(
    client.requestSkill('skill.importRemote', { url: 'https://example.com/SKILL.md' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ImportRemoteSkillResponse>>();
  expectTypeOf(client.requestSkill('skill.list', { limit: 20 })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListSkillsResponse>
  >();
  expectTypeOf(client.requestSkill('skill.get', { skillVersionId: 'version-1' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').GetSkillResponse>
  >();
  expectTypeOf(client.requestSkill('skill.delete', { skillVersionId: 'version-1' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').DeleteSkillResponse>
  >();
  expectTypeOf(
    client.requestSkill('skill.setEnabled', { skillVersionId: 'version-1', enabled: true }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SetSkillEnabledResponse>>();
  // @ts-expect-error Imports require SKILL.md source text.
  client.requestSkill('skill.import', {});
  // @ts-expect-error Skill reads require a version ID.
  client.requestSkill('skill.get', {});
  // @ts-expect-error Enable writes require a boolean state.
  client.requestSkill('skill.setEnabled', { skillVersionId: 'version-1' });
  // @ts-expect-error Skill Market commands belong to a separate contract.
  client.requestSkill('skill.market.list', {});
}

function assertMcpRegistryCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestMcpRegistry('mcp.register', { name: 'Local tools' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').RegisterMcpServerResponse>
  >();
  expectTypeOf(
    client.requestMcpRegistry('mcp.registerRemote', {
      name: 'Remote tools',
      endpoint: 'https://example.com/mcp',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').RegisterRemoteMcpResponse>>();
  expectTypeOf(client.requestMcpRegistry('mcp.list', { limit: 20 })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListMcpServersResponse>
  >();
  expectTypeOf(
    client.requestMcpRegistry('mcp.setEnabled', { mcpServerId: 'server-1', enabled: true }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SetMcpServerEnabledResponse>>();
  expectTypeOf(client.requestMcpRegistry('mcp.delete', { mcpServerId: 'server-1' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').DeleteMcpServerResponse>
  >();
  // @ts-expect-error Registrations require a display name.
  client.requestMcpRegistry('mcp.register', {});
  // @ts-expect-error Remote registrations require an endpoint.
  client.requestMcpRegistry('mcp.registerRemote', { name: 'Remote tools' });
  // @ts-expect-error Enable writes require a boolean state.
  client.requestMcpRegistry('mcp.setEnabled', { mcpServerId: 'server-1' });
  // @ts-expect-error MCP execution commands belong to a separate contract.
  client.requestMcpRegistry('mcp.tool.call', {});
}

function assertMcpToolCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestMcpTool('mcp.policy.probe', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ProbeMcpPolicyResponse>
  >();
  expectTypeOf(client.requestMcpTool('mcp.tool.request', { toolName: 'inspect' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').RequestMcpToolResponse>
  >();
  expectTypeOf(client.requestMcpTool('mcp.spawn.probe', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ProbeMcpSpawnResponse>
  >();
  expectTypeOf(
    client.requestMcpTool('mcp.tool.call', {
      mcpServerId: 'server-1',
      toolName: 'inspect',
      workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
      taskId: 'task-1' as import('@sync-think/shared').TaskId,
      runId: 'run-1' as import('@sync-think/shared').RunId,
      stepId: 'step-1' as import('@sync-think/shared').StepId,
      agentVersionId: 'agent-version-1' as import('@sync-think/shared').AgentVersionId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CallMcpToolResponse>>();
  expectTypeOf(
    client.requestMcpTool('mcp.tools.refresh', { mcpServerId: 'server-1' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').RefreshMcpToolsResponse>>();
  // @ts-expect-error Soft tool requests require a tool name.
  client.requestMcpTool('mcp.tool.request', {});
  // @ts-expect-error Real tool calls require exact orchestration scope.
  client.requestMcpTool('mcp.tool.call', { mcpServerId: 'server-1', toolName: 'inspect' });
  // @ts-expect-error Catalog refresh requires a registered server.
  client.requestMcpTool('mcp.tools.refresh', {});
  // @ts-expect-error Registry commands belong to a separate contract.
  client.requestMcpTool('mcp.register', { name: 'tools' });
}

function assertBotChannelCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestBotChannel('bot.channel.get', { platform: 'telegram' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').GetBotChannelConfigResponse>
  >();
  expectTypeOf(
    client.requestBotChannel('bot.channel.save', { platform: 'discord', enabled: true }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SaveBotChannelConfigResponse>>();
  expectTypeOf(client.requestBotChannel('bot.channel.test', { platform: 'feishu' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').TestBotChannelResponse>
  >();
  expectTypeOf(client.requestBotChannel('bot.channel.wechat.qr.request', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').RequestWechatBotQrResponse>
  >();
  expectTypeOf(
    client.requestBotChannel('bot.channel.wechat.qr.check', { qrcode: 'login-code' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CheckWechatBotQrResponse>>();
  // @ts-expect-error Configuration reads require a platform.
  client.requestBotChannel('bot.channel.get', {});
  // @ts-expect-error Configuration writes require enabled state.
  client.requestBotChannel('bot.channel.save', { platform: 'telegram' });
  // @ts-expect-error QR status checks require the login code.
  client.requestBotChannel('bot.channel.wechat.qr.check', {});
  // @ts-expect-error MCP commands belong to a separate contract.
  client.requestBotChannel('mcp.list', {});
}

function assertCapabilityGovernanceCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestCapabilityGovernance('capability.workspace.list', {
      workspaceId: 'workspace-1',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CapabilityWorkspaceListResponse>>();
  expectTypeOf(
    client.requestCapabilityGovernance('capability.workspace.setActive', {
      workspaceId: 'workspace-1',
      capabilityType: 'skill',
      capabilityId: 'version-1',
      active: true,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CapabilityWorkspaceSetActiveResponse>>();
  expectTypeOf(
    client.requestCapabilityGovernance('capability.governance.list', {
      workspaceId: 'workspace-1',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CapabilityGovernanceListResponse>>();
  expectTypeOf(
    client.requestCapabilityGovernance('capability.publishDraft.save', {
      skillVersionId: 'version-1',
      skillId: 'skill-1',
      displayName: 'Review',
      description: 'Review changes.',
      skillMd: '---\nname: review\n---\nReview.',
      category: 'development',
      version: '1.0.0',
      icon: 'sparkles',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SaveSkillPublishDraftResponse>>();
  expectTypeOf(
    client.requestCapabilityGovernance('capability.publishDraft.list', {}),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ListSkillPublishDraftsResponse>>();
  expectTypeOf(
    client.requestCapabilityGovernance('capability.publishDraft.get', { id: 'draft-1' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').GetSkillPublishDraftResponse>>();
  expectTypeOf(
    client.requestCapabilityGovernance('capability.publishDraft.submit', { id: 'draft-1' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SubmitSkillPublishDraftResponse>>();
  expectTypeOf(
    client.requestCapabilityGovernance('capability.organize.preview', {
      workspaceId: 'workspace-1',
      contextBudgetTokens: 15_000,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').PreviewCapabilityOrganizeResponse>>();
  expectTypeOf(
    client.requestCapabilityGovernance('capability.organize.getLatest', {
      workspaceId: 'workspace-1',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').GetLatestCapabilityOrganizeResponse>>();
  // @ts-expect-error Workspace activation queries require a workspace.
  client.requestCapabilityGovernance('capability.workspace.list', {});
  // @ts-expect-error Activation writes require an active boolean.
  client.requestCapabilityGovernance('capability.workspace.setActive', {
    workspaceId: 'workspace-1',
    capabilityType: 'skill',
    capabilityId: 'version-1',
  });
  // @ts-expect-error Organization previews require a token budget.
  client.requestCapabilityGovernance('capability.organize.preview', {
    workspaceId: 'workspace-1',
  });
  // @ts-expect-error Bot commands belong to a separate contract.
  client.requestCapabilityGovernance('bot.channel.get', { platform: 'telegram' });
}

function assertPromptDesignCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestPromptDesign('prompt.enhance', {
      requestId: 'enhance-1',
      text: 'Improve this prompt.',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').PromptEnhanceResponse>>();
  expectTypeOf(
    client.requestPromptDesign('prompt.enhance.cancel', { requestId: 'enhance-1' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').PromptEnhanceCancelResponse>>();
  expectTypeOf(
    client.requestPromptDesign('design.generate', {
      requestId: 'design-1',
      frame: { id: 'frame-1', type: 'magicframe' },
      children: [{ id: 'shape-1', type: 'rectangle' }],
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DesignGenerateResponse>>();
  // @ts-expect-error Prompt enhancement requires source text.
  client.requestPromptDesign('prompt.enhance', { requestId: 'enhance-1' });
  // @ts-expect-error Cancellation requires the stable request ID.
  client.requestPromptDesign('prompt.enhance.cancel', {});
  // @ts-expect-error Design generation requires a frame and child collection.
  client.requestPromptDesign('design.generate', { requestId: 'design-1' });
  // @ts-expect-error Capability Governance belongs to a separate contract.
  client.requestPromptDesign('capability.governance.list', { workspaceId: 'workspace-1' });
}

function assertWorkspaceCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(client.requestWorkspace('workspace.create', { name: 'Atlas' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').CreateWorkspaceResponse>
  >();
  expectTypeOf(
    client.requestWorkspace('workspace.bindFolder', {
      workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
      folderPath: 'D:/projects/atlas',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').BindWorkspaceFolderResponse>>();
  expectTypeOf(client.requestWorkspace('workspace.list', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListWorkspacesResponse>
  >();
  expectTypeOf(
    client.requestWorkspace('workspace.update', {
      workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
      name: 'Atlas 2',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').UpdateWorkspaceResponse>>();
  expectTypeOf(
    client.requestWorkspace('workspace.delete', {
      workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DeleteWorkspaceResponse>>();
  // @ts-expect-error Workspace creation requires a name.
  client.requestWorkspace('workspace.create', {});
  // @ts-expect-error Folder binding requires a folder path.
  client.requestWorkspace('workspace.bindFolder', {
    workspaceId: 'workspace-1' as import('@sync-think/shared').WorkspaceId,
  });
  // @ts-expect-error Workspace listing has no filters.
  client.requestWorkspace('workspace.list', { hidden: false });
  // @ts-expect-error Task commands belong to a separate contract.
  client.requestWorkspace('task.list', { workspaceId: 'workspace-1' });
}

function assertTaskCommandContracts(client: RuntimePipeClient) {
  const workspaceId = 'workspace-1' as import('@sync-think/shared').WorkspaceId;
  const taskId = 'task-1' as import('@sync-think/shared').TaskId;
  expectTypeOf(
    client.requestTask('task.create', {
      workspaceId,
      title: 'Review',
      goal: 'Inspect changes',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CreateTaskResponse>>();
  expectTypeOf(client.requestTask('task.list', { workspaceId })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListTasksResponse>
  >();
  expectTypeOf(client.requestTask('task.open', { taskId })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').OpenTaskResponse>
  >();
  expectTypeOf(client.requestTask('task.search', { workspaceId, query: 'review' })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').SearchTasksResponse>
  >();
  expectTypeOf(
    client.requestTask('task.archive', { taskId, expectedTaskVersion: 3 }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ArchiveTaskResponse>>();
  expectTypeOf(
    client.requestTask('task.unarchive', { taskId, expectedTaskVersion: 4 }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').UnarchiveTaskResponse>>();
  // @ts-expect-error Task creation requires title and goal.
  client.requestTask('task.create', { workspaceId });
  // @ts-expect-error Task listing requires a workspace.
  client.requestTask('task.list', {});
  // @ts-expect-error Task opening requires a task ID.
  client.requestTask('task.open', {});
  // @ts-expect-error Task search requires a query.
  client.requestTask('task.search', { workspaceId });
  // @ts-expect-error Archive requires an expected task version.
  client.requestTask('task.archive', { taskId });
  // @ts-expect-error Unarchive requires an expected task version.
  client.requestTask('task.unarchive', { taskId });
  // @ts-expect-error Workspace commands belong to a separate contract.
  client.requestTask('workspace.list', {});
}

function assertParticipationModeCommandContracts(client: RuntimePipeClient) {
  const taskId = 'task-1' as import('@sync-think/shared').TaskId;
  expectTypeOf(
    client.requestParticipationMode('task.setParticipationMode', {
      taskId,
      mode: 'collaboration',
      expectedTaskVersion: 3,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SetParticipationModeResponse>>();
  // @ts-expect-error Mode changes require optimistic task version fencing.
  client.requestParticipationMode('task.setParticipationMode', {
    taskId,
    mode: 'automatic',
  });
  // @ts-expect-error Task directory commands belong to a separate contract.
  client.requestParticipationMode('task.open', { taskId });
}

function assertPlanCommandContracts(client: RuntimePipeClient) {
  const taskId = 'task-1' as import('@sync-think/shared').TaskId;
  const planId = 'plan-1' as import('@sync-think/shared').PlanId;
  const steps: import('@sync-think/shared').PlanStepDraft[] = [
    {
      id: 'step-1' as import('@sync-think/shared').StepId,
      kind: 'execution',
      title: 'Inspect',
      instructions: 'Inspect the relevant files.',
      agentVersionId: 'agent-version-1' as import('@sync-think/shared').AgentVersionId,
      dependsOn: [],
    },
  ];
  expectTypeOf(
    client.requestPlan('plan.draft', {
      taskId,
      expectedTaskVersion: 2,
      title: 'Review plan',
      steps,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').PlanDraftResponse>>();
  expectTypeOf(
    client.requestPlan('plan.revise', { planId, expectedRevision: 1, steps }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').PlanReviseResponse>>();
  expectTypeOf(client.requestPlan('plan.listRevisions', { planId })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').PlanListRevisionsResponse>
  >();
  expectTypeOf(client.requestPlan('plan.approve', { planId, revision: 2 })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').PlanApproveResponse>
  >();
  // @ts-expect-error Plan draft requires task version, title and steps.
  client.requestPlan('plan.draft', { taskId });
  // @ts-expect-error Plan revision requires expected revision and steps.
  client.requestPlan('plan.revise', { planId });
  // @ts-expect-error Revision listing requires a plan ID.
  client.requestPlan('plan.listRevisions', {});
  // @ts-expect-error Approval requires a revision.
  client.requestPlan('plan.approve', { planId });
  // @ts-expect-error Run control belongs to a separate contract.
  client.requestPlan('run.getGraph', {});
}

function assertRunControlCommandContracts(client: RuntimePipeClient) {
  const workspaceId = 'workspace-1' as import('@sync-think/shared').WorkspaceId;
  const taskId = 'task-1' as import('@sync-think/shared').TaskId;
  const runId = 'run-1' as import('@sync-think/shared').RunId;
  const scope = { workspaceId, taskId, runId };
  expectTypeOf(client.requestRunControl('run.getGraph', scope)).toEqualTypeOf<
    Promise<import('@sync-think/protocol').RunGetGraphResponse>
  >();
  expectTypeOf(
    client.requestRunControl('run.pause', { ...scope, expectedTaskVersion: 2 }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').PauseRunResponse>>();
  expectTypeOf(
    client.requestRunControl('run.resume', { ...scope, expectedTaskVersion: 3 }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ResumeRunResponse>>();
  expectTypeOf(client.requestRunControl('run.cancel', { runId })).toEqualTypeOf<
    Promise<
      | import('@sync-think/protocol').PauseResumeCancelResponse
      | import('@sync-think/protocol').CancelOrchestrationRunResponse
    >
  >();
  expectTypeOf(
    client.requestRunControl('run.cancel', { ...scope, expectedTaskVersion: 4 }),
  ).toEqualTypeOf<
    Promise<
      | import('@sync-think/protocol').PauseResumeCancelResponse
      | import('@sync-think/protocol').CancelOrchestrationRunResponse
    >
  >();
  // @ts-expect-error Graph reads require the server-verified scope.
  client.requestRunControl('run.getGraph', { runId });
  // @ts-expect-error Pause requires optimistic task version fencing.
  client.requestRunControl('run.pause', scope);
  // @ts-expect-error Resume requires optimistic task version fencing.
  client.requestRunControl('run.resume', scope);
  // @ts-expect-error Cancel always requires a run ID.
  client.requestRunControl('run.cancel', {});
  // @ts-expect-error Plan commands belong to a separate contract.
  client.requestRunControl('plan.approve', {});
}

function assertArtifactCommandContracts(client: RuntimePipeClient) {
  const workspaceId = 'workspace-1' as import('@sync-think/shared').WorkspaceId;
  const taskId = 'task-1' as import('@sync-think/shared').TaskId;
  const runId = 'run-1' as import('@sync-think/shared').RunId;
  const artifactId = 'artifact-1' as import('@sync-think/shared').ArtifactId;
  const versionId = 'version-1' as import('@sync-think/shared').ArtifactVersionId;
  const leftVersionId = 'version-2' as import('@sync-think/shared').ArtifactVersionId;
  const rightVersionId = 'version-3' as import('@sync-think/shared').ArtifactVersionId;
  const scope = { workspaceId, taskId, runId };
  expectTypeOf(client.requestArtifact('artifact.list', scope)).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListArtifactsResponse>
  >();
  expectTypeOf(
    client.requestArtifact('artifact.getVersion', { ...scope, artifactVersionId: versionId }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').GetArtifactVersionResponse>>();
  expectTypeOf(
    client.requestArtifact('artifact.compare', { ...scope, leftVersionId, rightVersionId }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CompareArtifactVersionsResponse>>();
  expectTypeOf(
    client.requestArtifact('artifact.selectVersion', {
      ...scope,
      artifactId,
      artifactVersionId: versionId,
      operationId: 'operation-1',
      expectedTaskVersion: 2,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SelectArtifactVersionResponse>>();
  expectTypeOf(
    client.requestArtifact('artifact.merge', {
      ...scope,
      artifactId,
      baseVersionId: versionId,
      leftVersionId,
      rightVersionId,
      sourceStepId: 'step-1' as import('@sync-think/shared').StepId,
      operationId: 'operation-2',
      expectedTaskVersion: 3,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').MergeArtifactVersionsResponse>>();
  expectTypeOf(client.requestArtifact('artifact.listConflicts', scope)).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListArtifactMergeConflictsResponse>
  >();
  expectTypeOf(
    client.requestArtifact('artifact.resolveConflict', {
      ...scope,
      conflictId: 'conflict-1',
      strategy: 'left',
      operationId: 'operation-3',
      expectedTaskVersion: 4,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ResolveArtifactMergeConflictResponse>>();
  // @ts-expect-error Artifact listing requires the server-verified scope.
  client.requestArtifact('artifact.list', { workspaceId });
  // @ts-expect-error Version reads require an artifact version ID.
  client.requestArtifact('artifact.getVersion', scope);
  // @ts-expect-error Comparison requires both version IDs.
  client.requestArtifact('artifact.compare', { ...scope, leftVersionId });
  // @ts-expect-error Selection requires optimistic task version fencing.
  client.requestArtifact('artifact.selectVersion', {
    ...scope,
    artifactId,
    artifactVersionId: versionId,
    operationId: 'operation-4',
  });
  // @ts-expect-error Merge requires all three parent version IDs.
  client.requestArtifact('artifact.merge', { ...scope, artifactId });
  // @ts-expect-error Conflict resolution requires a strategy and operation identity.
  client.requestArtifact('artifact.resolveConflict', { ...scope, conflictId: 'conflict-1' });
  // @ts-expect-error Run control belongs to a separate contract.
  client.requestArtifact('run.getGraph', scope);
}

function assertProviderCatalogCommandContracts(client: RuntimePipeClient) {
  const providerId = 'provider-1' as import('@sync-think/shared').ProviderId;
  expectTypeOf(
    client.requestProviderCatalog('provider.create', {
      name: 'Gateway',
      baseUrl: 'https://api.example/v1',
      protocol: 'openai-chat',
      apiKey: 'secret',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').CreateProviderResponse>>();
  expectTypeOf(
    client.requestProviderCatalog('provider.update', { providerId, enabled: false }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').UpdateProviderResponse>>();
  expectTypeOf(client.requestProviderCatalog('provider.list', {})).toEqualTypeOf<
    Promise<import('@sync-think/protocol').ListProvidersResponse>
  >();
  expectTypeOf(
    client.requestProviderCatalog('provider.reorder', { orderedProviderIds: [providerId] }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ReorderProvidersResponse>>();
  expectTypeOf(client.requestProviderCatalog('provider.delete', { providerId })).toEqualTypeOf<
    Promise<import('@sync-think/protocol').DeleteProviderResponse>
  >();
  // @ts-expect-error Creation requires the credential hand-off.
  client.requestProviderCatalog('provider.create', {
    name: 'Gateway',
    baseUrl: 'https://api.example/v1',
    protocol: 'openai-chat',
  });
  // @ts-expect-error Update requires a provider ID.
  client.requestProviderCatalog('provider.update', { enabled: false });
  // @ts-expect-error Provider list currently has no typed filters.
  client.requestProviderCatalog('provider.list', { enabled: true });
  // @ts-expect-error Reorder requires the full ordered ID list.
  client.requestProviderCatalog('provider.reorder', {});
  // @ts-expect-error Credential commands belong to a separate contract.
  client.requestProviderCatalog('provider.removeCredential', { providerId });
}

function assertProviderCredentialCommandContracts(client: RuntimePipeClient) {
  const providerId = 'provider-1' as import('@sync-think/shared').ProviderId;
  const credentialRefId = 'credential-1' as import('@sync-think/shared').CredentialRefId;
  expectTypeOf(
    client.requestProviderCredential('provider.addCredential', {
      providerId,
      apiKey: 'secret',
      label: 'primary',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').AddProviderCredentialResponse>>();
  expectTypeOf(
    client.requestProviderCredential('provider.removeCredential', {
      providerId,
      credentialRefId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').RemoveProviderCredentialResponse>>();
  expectTypeOf(
    client.requestProviderCredential('provider.clearCredentials', { providerId }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ClearProviderCredentialsResponse>>();
  expectTypeOf(
    client.requestProviderCredential('provider.revealCredential', {
      providerId,
      credentialRefId,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').RevealProviderCredentialResponse>>();
  expectTypeOf(
    client.requestProviderCredential('provider.updateCredential', {
      providerId,
      credentialRefId,
      label: 'renamed',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').UpdateProviderCredentialResponse>>();
  // @ts-expect-error Internal add requests require the clipboard-injected secret.
  client.requestProviderCredential('provider.addCredential', { providerId });
  // @ts-expect-error Remove requires a credential identity.
  client.requestProviderCredential('provider.removeCredential', { providerId });
  // @ts-expect-error Clear accepts only a provider identity.
  client.requestProviderCredential('provider.clearCredentials', { providerId, credentialRefId });
  // @ts-expect-error Catalog commands belong to a separate contract.
  client.requestProviderCredential('provider.list', {});
}

function assertProviderModelCommandContracts(client: RuntimePipeClient) {
  const providerId = 'provider-1' as import('@sync-think/shared').ProviderId;
  const modelId = 'model-1' as import('@sync-think/shared').ModelId;
  expectTypeOf(
    client.requestProviderModel('provider.addModels', {
      providerId,
      protocol: 'openai-chat',
      models: [{ providerModelId: 'manual-model' }],
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').AddModelsResponse>>();
  expectTypeOf(
    client.requestProviderModel('provider.setModelPriorities', {
      providerId,
      entries: [{ modelId }],
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SetModelPrioritiesResponse>>();
  expectTypeOf(
    client.requestProviderModel('provider.updateModel', {
      providerId,
      modelId,
      displayName: 'Renamed',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').UpdateModelResponse>>();
  expectTypeOf(
    client.requestProviderModel('provider.removeModel', { providerId, modelId }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').RemoveModelResponse>>();
  // @ts-expect-error Add requires at least one model descriptor.
  client.requestProviderModel('provider.addModels', { providerId, protocol: 'openai-chat' });
  // @ts-expect-error Priority updates require an ordered entry list.
  client.requestProviderModel('provider.setModelPriorities', { providerId });
  // @ts-expect-error Update requires a model identity.
  client.requestProviderModel('provider.updateModel', { providerId, displayName: 'Renamed' });
  // @ts-expect-error Catalog commands belong to a separate contract.
  client.requestProviderModel('provider.list', {});
}

function assertProviderDiscoveryCommandContracts(client: RuntimePipeClient) {
  const providerId = 'provider-1' as import('@sync-think/shared').ProviderId;
  const modelId = 'model-1' as import('@sync-think/shared').ModelId;
  expectTypeOf(
    client.requestProviderDiscovery('provider.discoverModels', { providerId, persist: false }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DiscoverModelsResponse>>();
  expectTypeOf(
    client.requestProviderDiscovery('provider.probeModels', {
      baseUrl: 'https://api.example/v1',
      protocol: 'openai-chat',
      apiKey: 'secret',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ProbeModelsResponse>>();
  expectTypeOf(
    client.requestProviderDiscovery('provider.probeCapabilities', {
      providerId,
      modelId,
      visionOnly: true,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ProbeCapabilitiesResponse>>();
  expectTypeOf(
    client.requestProviderDiscovery('provider.confirmCapabilities', {
      modelId,
      capabilities: ['text', 'vision'],
      confirmed: true,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ConfirmCapabilitiesResponse>>();
  // @ts-expect-error Discovery requires a provider identity.
  client.requestProviderDiscovery('provider.discoverModels', {});
  // @ts-expect-error The internal probe hop requires the clipboard-injected secret.
  client.requestProviderDiscovery('provider.probeModels', {
    baseUrl: 'https://api.example/v1',
    protocol: 'openai-chat',
  });
  // @ts-expect-error Confirmation requires final capability tags.
  client.requestProviderDiscovery('provider.confirmCapabilities', { modelId });
  // @ts-expect-error Model mutations belong to a separate contract.
  client.requestProviderDiscovery('provider.addModels', {
    providerId,
    protocol: 'openai-chat',
    models: [],
  });
}

function assertProviderBalanceCommandContracts(client: RuntimePipeClient) {
  const providerId = 'provider-1' as import('@sync-think/shared').ProviderId;
  const credentialRefId = 'credential-1' as import('@sync-think/shared').CredentialRefId;
  expectTypeOf(
    client.requestProviderBalance('provider.balance', { providerId, credentialRefId }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ProviderBalanceResponse>>();
  // @ts-expect-error Balance lookup requires a provider identity.
  client.requestProviderBalance('provider.balance', {});
  // @ts-expect-error Discovery commands belong to a separate contract.
  client.requestProviderBalance('provider.discoverModels', { providerId });
}

function assertProviderCcSwitchCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestProviderCcSwitch('provider.previewCcSwitchImport', {}),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').PreviewCcSwitchImportResponse>>();
  expectTypeOf(
    client.requestProviderCcSwitch('provider.importCcSwitch', { sourceIds: ['source-1'] }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ImportCcSwitchResponse>>();
  // @ts-expect-error Import requires at least the source-id collection property.
  client.requestProviderCcSwitch('provider.importCcSwitch', {});
  // @ts-expect-error Provider balance belongs to a separate contract.
  client.requestProviderCcSwitch('provider.balance', {});
}

function assertWebSearchProviderCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestWebSearchProvider('webSearch.providers.list', {}),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ListWebSearchProvidersResponse>>();
  expectTypeOf(
    client.requestWebSearchProvider('webSearch.providers.save', {
      providerId: 'tavily',
      enabled: true,
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').SaveWebSearchProviderResponse>>();
  expectTypeOf(
    client.requestWebSearchProvider('webSearch.providers.reorder', {
      providerIds: [...WEB_SEARCH_PROVIDER_IDS],
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').ReorderWebSearchProvidersResponse>>();
  expectTypeOf(
    client.requestWebSearchProvider('webSearch.providers.test', { providerId: 'brave' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').TestWebSearchProviderResponse>>();
  // @ts-expect-error Saving requires the enabled flag.
  client.requestWebSearchProvider('webSearch.providers.save', { providerId: 'tavily' });
  // @ts-expect-error Provider catalog commands belong to a separate contract.
  client.requestWebSearchProvider('provider.list', {});
}

function assertDataManagementCommandContracts(client: RuntimePipeClient) {
  expectTypeOf(
    client.requestDataManagement('data.storageStats', {}),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DataStorageStatsResponse>>();
  expectTypeOf(
    client.requestDataManagement('data.export', { filePath: 'D:/export.json' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DataExportResponse>>();
  expectTypeOf(
    client.requestDataManagement('data.import', {
      filePath: 'D:/import.json',
      conflictStrategy: 'skip',
    }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DataImportResponse>>();
  expectTypeOf(
    client.requestDataManagement('data.backup', { targetDirectory: 'D:/backups' }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DataBackupResponse>>();
  expectTypeOf(
    client.requestDataManagement('data.compactStorage', {}),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DataCompactStorageResponse>>();
  expectTypeOf(
    client.requestDataManagement('data.cleanConversations', { beforeTimestamp: 42 }),
  ).toEqualTypeOf<Promise<import('@sync-think/protocol').DataCleanConversationsResponse>>();
  expectTypeOf(
    client.requestDataManagement('data.cleanEmptyAttachmentDirectories', {}),
  ).toEqualTypeOf<
    Promise<import('@sync-think/protocol').DataCleanEmptyAttachmentDirectoriesResponse>
  >();
  // @ts-expect-error Import requires a conflict strategy.
  client.requestDataManagement('data.import', { filePath: 'D:/import.json' });
  // @ts-expect-error Web Search belongs to a separate contract.
  client.requestDataManagement('webSearch.providers.list', {});
}

it('keeps compile-time command assertions available to the TypeScript gate', () => {
  expectTypeOf(assertCommandContracts).toBeFunction();
  expectTypeOf(assertBrowserProfileCommandContracts).toBeFunction();
  expectTypeOf(assertBrowserRecordingCommandContracts).toBeFunction();
  expectTypeOf(assertBrowserWorkflowCommandContracts).toBeFunction();
  expectTypeOf(assertBrowserHandoffCommandContracts).toBeFunction();
  expectTypeOf(assertDesktopCommandContracts).toBeFunction();
  expectTypeOf(assertBrowserExtensionCommandContracts).toBeFunction();
  expectTypeOf(assertApprovalCommandContracts).toBeFunction();
  expectTypeOf(assertMemoryCommandContracts).toBeFunction();
  expectTypeOf(assertContextPacketCommandContracts).toBeFunction();
  expectTypeOf(assertDiagnosticsCommandContracts).toBeFunction();
  expectTypeOf(assertGatewayCommandContracts).toBeFunction();
  expectTypeOf(assertKernelCommandContracts).toBeFunction();
  expectTypeOf(assertSettingsCommandContracts).toBeFunction();
  expectTypeOf(assertPolicyCommandContracts).toBeFunction();
  expectTypeOf(assertUsageCommandContracts).toBeFunction();
  expectTypeOf(assertAgentCommandContracts).toBeFunction();
  expectTypeOf(assertGlobalAgentCommandContracts).toBeFunction();
  expectTypeOf(assertTeamCommandContracts).toBeFunction();
  expectTypeOf(assertScheduledTaskCommandContracts).toBeFunction();
  expectTypeOf(assertActivityCommandContracts).toBeFunction();
  expectTypeOf(assertGoalCommandContracts).toBeFunction();
  expectTypeOf(assertSkillLocalCommandContracts).toBeFunction();
  expectTypeOf(assertSkillMarketCommandContracts).toBeFunction();
  expectTypeOf(assertSkillCommandContracts).toBeFunction();
  expectTypeOf(assertMcpRegistryCommandContracts).toBeFunction();
  expectTypeOf(assertMcpToolCommandContracts).toBeFunction();
  expectTypeOf(assertBotChannelCommandContracts).toBeFunction();
  expectTypeOf(assertCapabilityGovernanceCommandContracts).toBeFunction();
  expectTypeOf(assertPromptDesignCommandContracts).toBeFunction();
  expectTypeOf(assertWorkspaceCommandContracts).toBeFunction();
  expectTypeOf(assertTaskCommandContracts).toBeFunction();
  expectTypeOf(assertParticipationModeCommandContracts).toBeFunction();
  expectTypeOf(assertPlanCommandContracts).toBeFunction();
  expectTypeOf(assertRunControlCommandContracts).toBeFunction();
  expectTypeOf(assertArtifactCommandContracts).toBeFunction();
  expectTypeOf(assertProviderCatalogCommandContracts).toBeFunction();
  expectTypeOf(assertProviderCredentialCommandContracts).toBeFunction();
  expectTypeOf(assertProviderModelCommandContracts).toBeFunction();
  expectTypeOf(assertProviderDiscoveryCommandContracts).toBeFunction();
  expectTypeOf(assertProviderBalanceCommandContracts).toBeFunction();
  expectTypeOf(assertProviderCcSwitchCommandContracts).toBeFunction();
  expectTypeOf(assertWebSearchProviderCommandContracts).toBeFunction();
  expectTypeOf(assertDataManagementCommandContracts).toBeFunction();
});
