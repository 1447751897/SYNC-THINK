export interface ReadApprovalRequestImagePayload {
  conversationId: string;
  messageId: string;
  runId: string;
  imageId: string;
}

export interface ReadApprovalRequestImageResponse {
  dataUrl: string;
  mimeType: string;
}
