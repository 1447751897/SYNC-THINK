import { useEffect, useRef } from 'react';
import type {
  ConversationTransientFrame,
  ConversationTransientSnapshot,
} from '@sync-think/protocol';

export type ConversationTransientSubscriptionEvent =
  | { type: 'frame'; frame: ConversationTransientFrame }
  | {
      type: 'reset';
      latestStreamSequence: number;
      snapshot?: ConversationTransientSnapshot;
    };

export interface ConversationTransientSubscription {
  ready: Promise<{ subscriptionId: string }>;
  unsubscribe(): Promise<void>;
}

export interface ConversationTransientSubscriptionPort {
  (
    payload: { threadId: string; afterStreamSequence?: number },
    listener: (event: ConversationTransientSubscriptionEvent) => void,
  ): ConversationTransientSubscription | undefined;
}

export function useConversationTransientSubscription(options: {
  scopeKey: string;
  threadId?: string;
  enabled: boolean;
  subscribe: ConversationTransientSubscriptionPort;
  getAfterStreamSequence(): number;
  onStarted(): void;
  onEvent(event: ConversationTransientSubscriptionEvent): void;
  onFailure(): void;
  onDispose(): void;
}): void {
  const { enabled, scopeKey, subscribe, threadId } = options;
  const callbacksRef = useRef({
    getAfterStreamSequence: options.getAfterStreamSequence,
    onStarted: options.onStarted,
    onEvent: options.onEvent,
    onFailure: options.onFailure,
    onDispose: options.onDispose,
  });
  callbacksRef.current = {
    getAfterStreamSequence: options.getAfterStreamSequence,
    onStarted: options.onStarted,
    onEvent: options.onEvent,
    onFailure: options.onFailure,
    onDispose: options.onDispose,
  };
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!enabled || !threadId) return;

    let disposed = false;
    const subscription = subscribe(
      {
        threadId,
        afterStreamSequence: callbacksRef.current.getAfterStreamSequence(),
      },
      (event) => {
        if (disposed || generationRef.current !== generation) return;
        callbacksRef.current.onEvent(event);
      },
    );
    if (!subscription) return;
    callbacksRef.current.onStarted();
    void subscription.ready.catch(() => {
      if (!disposed && generationRef.current === generation) callbacksRef.current.onFailure();
    });

    return () => {
      disposed = true;
      callbacksRef.current.onDispose();
      void subscription.unsubscribe();
    };
  }, [enabled, scopeKey, subscribe, threadId]);
}
