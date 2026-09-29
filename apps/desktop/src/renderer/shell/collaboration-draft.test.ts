/** @vitest-environment jsdom */
import { beforeEach, expect, it } from 'vitest';
import type { CollaborationSnapshot } from '@sync-think/shared';
import { preservePromotedDraft, takePromotedDraft } from './collaboration-draft.js';
beforeEach(() => sessionStorage.clear());
it('preserves an unsent draft once when upgrading', () => {
  sessionStorage.setItem('sync-think.collaboration-draft.v1:c', JSON.stringify({ text: '还没发出去', recipients: [] }));
  preservePromotedDraft('c'); expect(takePromotedDraft('c')).toBe('还没发出去'); expect(takePromotedDraft('c')).toBeUndefined();
});
it('does not restore an already accepted message after its acknowledgement timed out', () => {
  sessionStorage.setItem('sync-think.collaboration-draft.v1:c', JSON.stringify({ text: '收到的消息', recipients: [], receipt: { id: 'r', key: JSON.stringify(['收到的消息', [], undefined]) } }));
  preservePromotedDraft('c', { receipts: { 'send:r': 'message-id' } } as unknown as CollaborationSnapshot);
  expect(takePromotedDraft('c')).toBeUndefined();
});
it('retains text changed after a previously accepted send', () => {
  sessionStorage.setItem('sync-think.collaboration-draft.v1:c', JSON.stringify({ text: '新想法', recipients: [], receipt: { id: 'r', key: JSON.stringify(['旧消息', [], undefined]) } }));
  preservePromotedDraft('c', { receipts: { 'send:r': 'message-id' } } as unknown as CollaborationSnapshot);
  expect(takePromotedDraft('c')).toBe('新想法');
});
