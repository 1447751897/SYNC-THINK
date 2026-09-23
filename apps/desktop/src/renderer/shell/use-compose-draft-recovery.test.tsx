// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComposeAttachment } from './compose-mention.js';
import { takeFailedComposeDrafts } from './failed-compose-drafts.js';
import { useComposeDraftRecovery } from './use-compose-draft-recovery.js';

const sent: ComposeAttachment = {
  path: 'image:one',
  name: 'one.png',
  kind: 'image',
  previewUrl: 'data:image/png;base64,AA==',
};
const added: ComposeAttachment = { path: 'other', name: 'other.txt', kind: 'file' };
function useFixture(scope: string) {
  const [text, setInput] = useState('');
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([sent]);
  const inputRef = useRef({ value: text });
  inputRef.current.value = text;
  return {
    ...useComposeDraftRecovery({ scope, inputRef, setInput, setAttachments }),
    text,
    attachments,
    setInput,
    setAttachments,
  };
}
afterEach(() => {
  cleanup();
  takeFailedComposeDrafts('draft-a');
  takeFailedComposeDrafts('draft-b');
});

it('removes only sent attachments after success and retains attachments added during the request', async () => {
  const { result } = renderHook(() => useFixture('draft-a'));
  let finish!: (value: boolean) => void;
  const send = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  let request!: Promise<void>;
  act(() => {
    request = result.current.sendDraft({ text: 'read', attachments: [sent] }, send);
  });
  act(() => result.current.setAttachments([sent, added]));
  await act(async () => {
    finish(true);
    await request;
  });
  expect(result.current.attachments).toEqual([added]);
  expect(send).toHaveBeenCalledWith('read', [
    { id: 'image:one', name: 'one.png', mimeType: undefined, url: sent.previewUrl },
  ]);
});
it('restores a failed empty draft while preserving the newest attachment with the same path', async () => {
  const { result } = renderHook(() => useFixture('draft-a'));
  const updated = { ...sent, name: 'updated.png' };
  act(() => result.current.setAttachments([updated, added]));
  await act(async () => {
    await result.current.sendDraft(
      { text: 'read', attachments: [sent] },
      vi.fn().mockRejectedValue(new Error('offline')),
    );
  });
  expect(result.current.text).toBe('read');
  expect(result.current.attachments).toEqual([updated, added]);
});
it('retains a late failure under its original scope and merges it only when restored there', async () => {
  const { result, rerender } = renderHook(({ scope }) => useFixture(scope), {
    initialProps: { scope: 'draft-a' },
  });
  let reject!: (error: Error) => void;
  let request!: Promise<void>;
  act(() => {
    request = result.current.sendDraft(
      { text: 'original', attachments: [sent] },
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
  });
  rerender({ scope: 'draft-b' });
  await act(async () => {
    reject(new Error('offline'));
    await request;
  });
  expect(result.current.text).toBe('');
  expect(result.current.failedComposeDrafts).toHaveLength(0);
  rerender({ scope: 'draft-a' });
  expect(result.current.failedComposeDrafts).toHaveLength(1);
  act(() => result.current.setInput('new edit'));
  act(() => result.current.restoreFailedDrafts());
  expect(result.current.text).toBe('new edit\n\noriginal');
  expect(result.current.failedComposeDrafts).toHaveLength(0);
});
