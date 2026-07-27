import type { ConversationTransientFrame } from '@sync-think/protocol';
import type { ConversationStreamDraft, ConversationStreamOperation } from './chat-stream.js';
import { applyConversationStreamOperations } from './chat-stream.js';

export interface TransientDraftState {
  draft: ConversationStreamDraft | null;
  lastStreamSequence: number;
  terminal: boolean;
}

/**
 * Apply one thread-scoped transient frame with cursor dedupe. A frame from a
 * different thread is ignored defensively even though Runtime subscriptions are scoped.
 */
export function applyTransientConversationFrame(input: {
  current: ConversationStreamDraft | null;
  frame: ConversationTransientFrame;
  threadId: string;
  afterStreamSequence: number;
}): TransientDraftState {
  const { frame } = input;
  if (frame.threadId !== input.threadId || frame.streamSequence <= input.afterStreamSequence) {
    return {
      draft: input.current,
      lastStreamSequence: input.afterStreamSequence,
      terminal: false,
    };
  }

  if (frame.kind === 'process') {
    return {
      draft:
        input.current?.runId === frame.runId
          ? input.current
          : {
              runId: frame.runId,
              text: '',
              timestamp: frame.occurredAt,
            },
      lastStreamSequence: frame.streamSequence,
      terminal: false,
    };
  }

  let operation: ConversationStreamOperation;
  if (frame.kind === 'terminal') {
    operation = {
      type: 'run.terminal',
      runId: frame.runId,
      sequence: frame.streamSequence,
    };
  } else {
    operation = {
      type: frame.kind === 'text' ? 'text.delta' : 'reasoning.delta',
      runId: frame.runId,
      delta: frame.textDelta ?? '',
      occurredAt: frame.occurredAt,
      sequence: frame.streamSequence,
    };
  }

  return {
    draft: applyConversationStreamOperations(input.current, [operation]),
    lastStreamSequence: frame.streamSequence,
    terminal: frame.kind === 'terminal',
  };
}
