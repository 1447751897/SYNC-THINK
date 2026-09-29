import type { CollaborationSnapshot } from '@sync-think/shared';
export const promotedDraftKey = (id: string) => 'sync-think.promoted-direct-draft.v1:' + id;
/** Carry only an unacknowledged draft; a durable receipt means the message was already sent. */
export function preservePromotedDraft(id: string, snapshot?: CollaborationSnapshot) {
  const key = 'sync-think.collaboration-draft.v1:' + id;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    const draft = JSON.parse(raw) as { text?: string; receipt?: { id: string; key: string }; recipients?: string[]; replyTo?: string };
    const sent = draft.receipt && snapshot?.receipts['send:' + draft.receipt.id]
      && draft.receipt.key === JSON.stringify([draft.text, draft.recipients ?? [], draft.replyTo]);
    if (!sent && draft.text?.trim()) sessionStorage.setItem(promotedDraftKey(id), draft.text);
    sessionStorage.removeItem(key);
  } catch { /* Keep the original draft if storage is unavailable. */ }
}
export function takePromotedDraft(id: string): string | undefined {
  try {
    const key = promotedDraftKey(id), text = sessionStorage.getItem(key);
    if (text) sessionStorage.removeItem(key);
    return text ?? undefined;
  } catch { return undefined; }
}
