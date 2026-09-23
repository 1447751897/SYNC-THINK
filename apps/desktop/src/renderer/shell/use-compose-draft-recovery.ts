import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  readFailedComposeDrafts,
  rememberFailedComposeDraft,
  subscribeFailedComposeDrafts,
  takeFailedComposeDrafts,
  type FailedComposeDraft,
} from './failed-compose-drafts.js';
import {
  buildMessageWithAttachments,
  messageImagesFromAttachments,
  type ComposeAttachment,
} from './compose-mention.js';
import type { SendComposeText } from './compose-send-request.js';

function mergeAttachments(
  earlier: readonly ComposeAttachment[],
  current: readonly ComposeAttachment[],
) {
  return [
    ...new Map(
      [...earlier, ...current].map((attachment) => [attachment.path, attachment]),
    ).values(),
  ];
}

/** Owns post-send draft reconciliation, including delivery after navigation or remount. */
export function useComposeDraftRecovery({
  scope,
  inputRef,
  setInput,
  setAttachments,
}: {
  scope: string;
  inputRef: { readonly current: { readonly value: string } | null };
  setInput: Dispatch<SetStateAction<string>>;
  setAttachments: Dispatch<SetStateAction<ComposeAttachment[]>>;
}) {
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const subscribe = useCallback(
    (listener: () => void) => subscribeFailedComposeDrafts(scope, listener),
    [scope],
  );
  const snapshot = useCallback(() => readFailedComposeDrafts(scope), [scope]);
  const failedComposeDrafts = useSyncExternalStore(subscribe, snapshot, snapshot);

  const sendDraft = useCallback(
    async (draft: FailedComposeDraft, send: SendComposeText) => {
      const current = () => mounted.current && activeScope.current === scope;
      try {
        await send(
          buildMessageWithAttachments(draft.text, draft.attachments),
          messageImagesFromAttachments(draft.attachments),
        );
        if (current())
          setAttachments((attachments) =>
            attachments.filter(
              (attachment) => !draft.attachments.some((sent) => sent.path === attachment.path),
            ),
          );
      } catch {
        if (current() && inputRef.current?.value === '') {
          setInput(draft.text);
          setAttachments((attachments) => mergeAttachments(draft.attachments, attachments));
        } else {
          rememberFailedComposeDraft(scope, draft);
        }
      }
    },
    [inputRef, scope, setAttachments, setInput],
  );

  const restoreFailedDrafts = useCallback(() => {
    const drafts = takeFailedComposeDrafts(scope);
    setInput((current) =>
      [current, ...drafts.map((draft) => draft.text)].filter(Boolean).join('\n\n'),
    );
    setAttachments((current) =>
      mergeAttachments(
        drafts.flatMap((draft) => draft.attachments),
        current,
      ),
    );
  }, [scope, setAttachments, setInput]);

  return { failedComposeDrafts, sendDraft, restoreFailedDrafts };
}
