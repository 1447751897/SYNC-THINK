import type { ResolveApplicationToolConfirmationPayload } from '@sync-think/protocol';

export function parseResolveApplicationToolConfirmationPayload(
  value: unknown,
): ResolveApplicationToolConfirmationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid application-tool confirmation payload');
  }
  const payload = value as Partial<ResolveApplicationToolConfirmationPayload>;
  const keys = Object.keys(value);
  if (
    keys.some((key) => key !== 'confirmationId' && key !== 'threadId') ||
    typeof payload.confirmationId !== 'string' ||
    payload.confirmationId.trim().length === 0 ||
    payload.confirmationId.length > 256 ||
    typeof payload.threadId !== 'string' ||
    payload.threadId.trim().length === 0 ||
    payload.threadId.length > 256
  ) {
    throw new Error('Invalid application-tool confirmation payload');
  }
  return {
    confirmationId: payload.confirmationId.trim(),
    threadId: payload.threadId.trim() as ResolveApplicationToolConfirmationPayload['threadId'],
  };
}
